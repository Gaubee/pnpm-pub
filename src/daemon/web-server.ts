/**
 * WebUI HTTP + WebSocket server (Chapter 3.2.2, 5.2.2, 5.2.3).
 *
 * Serves the SvelteKit SPA from `dist/webui` and upgrades WebSocket connections
 * carrying the daemon's per-process WebToken. All NPM write intents are
 * funnelled through the WS bridge into the scheduler.
 */
import http from 'node:http';
import path from 'node:path';
import { promises as fsp, existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { DaemonStore } from './store.js';
import type { PublishScheduler } from './scheduler.js';
import { acceptWebSocket, WebSocketConnection, type SocketLike } from './ws.js';
import type { BackupBundle, PubEvent, WsClientMessage, WsServerMessage, TrustedPublisherConfig } from '../shared/index.js';
import { z } from 'zod';
import { BackupBundleSchema, WsClientMessageSchema, TrustedPublisherConfigSchema } from '../shared/schemas.js';
import { findProjectRoot, scanWorkspace, isPublishableByProfile, isRiskyRoot, readWorkspacePackages } from './workspace.js';
import { realFs } from './real-fs.js';
import { applyToken, verifyCredentials } from './npm-api.js';
import { getCachedRepoInfo } from './repo-info.js';
import { listMaintainerPackages, type NpmPackage } from './npm-packages.js';
import { fetchPackageDetail, type PackageDetailResult } from './npm-package-detail.js';
import { readProfileDetail } from './npm-profile-client.js';
import { setToken, setTotpSecret, getToken, getTotpSecret, deleteToken, deleteTotpSecret, getProfileSecrets, setProfileSecrets, type ProfileSecrets } from './keychain.js';
import { exportBundle, importBundle } from './crypto.js';
import { burnBuffer } from './totp.js';
import { lookupNpmProfileIdentity } from './avatar.js';
import { recordTokenCreatedAt } from './auto-renew.js';
import {
	listTrustedPublishers,
	addTrustedPublisher,
	removeTrustedPublisher,
} from './oidc-trust.js';

export interface WebServerDeps {
  store: DaemonStore;
  scheduler: PublishScheduler;
  webToken: string;
  webuiDir: string;
  log?: (message: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

type JsonObject = Record<string, unknown>;

/**
 * Result of {@link WebServer.resolveTrustAuth}: the active profile's token is
 * either ready to use (`ok`), absent (`missing`), or present but rejected by the
 * registry liveness probe (`expired` — caller should surface a re-auth signal).
 */
type ResolvedAuth =
  | { status: 'ok'; token: string; totpSecret: string; registry: string }
  | { status: 'missing' }
  | { status: 'expired' };

export class WebServer {
  private server?: http.Server;
  private sockets = new Set<WebSocketConnection>();
  private authedSockets = new WeakSet<WebSocketConnection>();

  /**
   * Trusted-publisher lookup cache (Chapter 8.5). npm's `/trust` list is a
   * network call behind 2FA, so we (a) dedup concurrent in-flight checks per
   * package (share one promise) and (b) keep results for 30s before re-querying.
   */
  private trustCache = new Map<string, { promise: Promise<TrustedPublisherConfig[]>; expiresAt: number }>();
  private static readonly TRUST_CACHE_TTL_MS = 30_000;

  /**
   * Per-profile maintainer package cache (Packages hub). The npm search walk is
   * paginated (250/page), so we cache the full list for ~60s and dedup
   * concurrent in-flight walks for the same profile:registry key.
   */
  private packagesCache = new Map<string, { promise: Promise<NpmPackage[]>; expiresAt: number }>();
  private static readonly PACKAGES_CACHE_TTL_MS = 60_000;

  /**
   * Per-package detail projection cache (PackageDetail page). The packument +
   * collaborators + downloads fan-out is several network calls, so we cache the
   * merged projection for ~60s and dedup concurrent in-flight fetches per
   * package:registry. A failure deletes the slot so it isn't poisoned.
   */
  private detailCache = new Map<string, { promise: Promise<PackageDetailResult>; expiresAt: number }>();
  private static readonly DETAIL_CACHE_TTL_MS = 60_000;

  /**
   * Token liveness probe cache. `resolveTrustAuth` verifies the active token
   * against the registry (`listTokens`, a read-only GET) before handing it to a
   * read path, so a stale/expired token flips `authStatus` to `unauthenticated`
   * and surfaces a re-auth signal instead of a confusing 401. The probe is
   * cached per-username for a short window to avoid hammering the registry on
   * every read (profile-detail / packages / trust / unpublish share it).
   * Invalidated whenever credentials change (renew / add / import / re-auth).
   */
  private authProbeCache = new Map<string, { authValid: boolean; expiresAt: number }>();
  private static readonly AUTH_PROBE_TTL_MS = 60_000;

  constructor(private deps: WebServerDeps) {
    // Relay store events to every authed WebUI client.
    this.deps.store.on('event', (msg) => this.broadcast(msg));
    this.deps.store.on('profiles', (msg) => this.broadcast(msg));
    this.deps.store.on('workspaces', (msg) => this.broadcast(msg));
  }

  async start(port = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket));
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        this.server = server;
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) {
      try {
        s.write({ type: 'toast', level: 'info', message: 'Daemon shutting down.' });
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  // ----- HTTP: SPA + token-scoped JSON API -----

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url ?? '/').split('?')[0]!;
    const method = req.method ?? 'GET';

    // JSON API endpoints — all token-guarded (Chapter 3.2.2 强鉴权).
    if (url.startsWith('/api/')) {
      if (!this.checkAuth(req)) {
        this.deps.log?.(`[api] 401 ${method} ${url} (auth failed — no/bad Bearer)`);
        return json(res, 401, { ok: false, error: 'Unauthorized' });
      }
      try {
        const body = method !== 'GET' ? await readJson(req) : {};
        if (url === '/api/npm-profile' && method === 'GET') {
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const username = query.get('username');
          if (!username) throw new Error('Invalid or missing username.');
          const result = await lookupNpmProfileIdentity(
            username,
            query.get('registry') ?? 'https://registry.npmjs.org/',
          );
          return json(res, 200, { ok: true, profile: result });
        }
        if (url === '/api/profile-token' && method === 'GET') {
          // Resolve the profile's npm_token from the in-memory credential pool
          // first, falling back to the merged keychain item (one read). The
          // WebUI uses this for the Profile "show / copy npm_token" affordance.
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const username = query.get('username');
          if (!username) throw new Error('Invalid or missing username.');
          let token = this.deps.store.getCredentials(username)?.token ?? null;
          if (!token) {
            const secrets = await getProfileSecrets(username);
            token = secrets?.npm_token ?? null;
          }
          return json(res, 200, token ? { ok: true, token } : { ok: false, error: 'No token stored for this profile.' });
        }
        if (url === '/api/profile-password' && method === 'GET') {
          // Resolve the stored npm password from the in-memory credential pool
          // first, falling back to the merged keychain item (one read). The WebUI
          // pre-fills the re-auth password field with it (the user may overwrite
          // it if the stored password is stale). Never persisted client-side.
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const username = query.get('username');
          if (!username) throw new Error('Invalid or missing username.');
          let password = this.deps.store.getCredentials(username)?.npmPwd ?? null;
          if (!password) {
            const secrets = await getProfileSecrets(username);
            password = secrets?.npm_pwd ?? null;
          }
          return json(res, 200, password ? { ok: true, password } : { ok: false, error: 'No password stored for this profile.' });
        }
        if (url === '/api/profile-detail' && method === 'GET') {
          // Live authenticated profile detail (name/email/social/2FA/created).
          // Resolved from the active profile's token; never persisted — these
          // fields are projections of the registry, not config.
          const username = this.deps.store.getDefault();
          if (!username) return json(res, 401, { ok: false, error: 'No active profile.' });
          const auth = await this.resolveTrustAuth();
          if (!authIsOk(auth)) return json(res, 401, authDeniedBody(auth));
          try {
            const detail = await readProfileDetail(auth.token, auth.registry);
            return json(res, 200, { ok: true, detail });
          } catch (err: unknown) {
            return json(res, 502, { ok: false, error: errorToMessage(err) });
          }
        }
        if (url === '/api/add-profile' && method === 'POST') {
          const result = await this.addProfile(parseAddProfileBody(body));
          return json(res, 200, result);
        }
        if (url === '/api/renew' && method === 'POST') {
          const result = await this.renewProfile(parseRenewProfileBody(body));
          return json(res, 200, result);
        }
        if (url === '/api/profile/auto-renew' && method === 'POST') {
          const parsed = parseOrThrow(z.object({ username: z.string().min(1), autoRenew: z.boolean() }), body, 'auto-renew body');
          const existing = this.deps.store.getProfile(parsed.username);
          if (!existing) return json(res, 404, { ok: false, error: 'Profile not found.' });
          this.deps.store.upsertProfile({ ...existing, autoRenew: parsed.autoRenew });
          return json(res, 200, { ok: true });
        }
        if (url === '/api/export' && method === 'POST') {
          const parsed = parseOrThrow(ExportBodySchema, body, 'export body');
          const result = await this.exportBundle(parsed.password);
          return json(res, 200, result);
        }
        if (url === '/api/import' && method === 'POST') {
          let parsed;
          try {
            parsed = parseOrThrow(ImportBodySchema, body, 'import body');
          } catch {
            return json(res, 400, { ok: false, error: 'Invalid backup bundle.' });
          }
          const result = await this.importBundle(parsed.bundle, parsed.password, parsed.usernames);
          return json(res, 200, result);
        }
        if (url === '/api/packages' && method === 'GET') {
          // Packages hub — list the active profile's published packages from the
          // npm registry, with server-side search / sort / pagination.
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const parsed = parseOrThrow(PackagesQuerySchema, {
            q: query.get('q') ?? query.get('query') ?? '',
            sort: query.get('sort') ?? 'date',
            page: query.get('page') ?? '0',
            pageSize: query.get('pageSize') ?? query.get('per_page') ?? '25',
          }, 'packages query');
          const result = await this.listPackages(parsed.q, parsed.sort, parsed.page, parsed.pageSize);
          return json(res, result.ok ? 200 : result.status, result);
        }
        // PackageDetail page — GET /api/packages/<name>/detail. The dispatcher is
        // exact-string, so the path param is parsed via regex here. Scoped names
        // are URL-encoded (`@scope%2Fpkg`, no bare `/`) so the capture is safe.
        const detailMatch = url.match(/^\/api\/packages\/([^/]+)\/detail$/);
        if (detailMatch && method === 'GET') {
          const name = decodeURIComponent(detailMatch[1]!);
          if (!name) throw new Error('Invalid or missing package name.');
          const result = await this.listPackageDetailCached(name);
          this.deps.log?.(`[packages] detail ${name}: ${result.ok ? 'ok' : `fail ${result.status}`}`);
          return json(res, result.ok ? 200 : result.status, result.ok ? { ok: true, detail: result.detail } : { ok: false, error: result.error });
        }
        if (url === '/api/events' && method === 'GET') {
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const parsed = parseOrThrow(EventsQuerySchema, {
            scope: query.get('scope') ?? 'history',
            name: query.get('name') ?? undefined,
            q: query.get('q') ?? '',
            group: query.get('group') ?? undefined,
            page: query.get('page') ?? '0',
            limit: query.get('limit') ?? '20',
          }, 'events query');
          // Parse `name:pkg keywords` syntax out of the free-text q.
          let name = parsed.name;
          const keywords: string[] = [];
          for (const tok of parsed.q.split(/\s+/).filter(Boolean)) {
            const m = tok.match(/^name:(.+)$/i);
            if (m) name = m[1];
            else keywords.push(tok);
          }
          const result = this.deps.store.queryEvents({
            status: parsed.scope,
            ...(name ? { name } : {}),
            ...(keywords.length ? { keywords } : {}),
            ...(parsed.group ? { groupId: parsed.group } : {}),
            page: parsed.page,
            limit: parsed.limit,
          });
          return json(res, 200, result);
        }
        if (url === '/api/repo-info' && method === 'GET') {
          // Resolve a repository string (slug or URL) into a display descriptor
          // (host/shortName/browseUrl/faviconUrl/brand), backed by the TTL KV
          // cache. Known forges return an inline-SVG brand; unknown hosts fall
          // back to a third-party favicon service.
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const repo = query.get('repo');
          if (!repo) throw new Error('Invalid or missing repo.');
          const info = getCachedRepoInfo(this.deps.store.getEventDb(), repo);
          return json(res, 200, { ok: true, info });
        }
        if (url === '/api/open-path' && method === 'POST') {
          // Open a local path in the OS file manager (Finder/Explorer/…).
          // Shells out to the platform opener; only directory opens are honored.
          const parsed = parseOrThrow(z.object({ path: z.string().min(1) }), body, 'open-path body');
          const target = path.resolve(parsed.path);
          const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          const args = process.platform === 'win32' ? ['', target] : [target];
          try {
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            await promisify(execFile)(cmd, args, { maxBuffer: 1024 });
            return json(res, 200, { ok: true });
          } catch (err) {
            return json(res, 500, { ok: false, error: errorToMessage(err) });
          }
        }
        if (url === '/api/open-url' && method === 'POST') {
          // Open a URL in the OS default browser. Inside the opentray webview,
          // <a target="_blank"> is intercepted/not forwarded to the system
          // browser, so the page calls this endpoint to shell out to the opener.
          const parsed = parseOrThrow(z.object({ url: z.string().min(1) }), body, 'open-url body');
          const target = parsed.url;
          const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
          const args = process.platform === 'win32' ? ['', target] : [target];
          try {
            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            await promisify(execFile)(cmd, args, { maxBuffer: 1024 });
            return json(res, 200, { ok: true });
          } catch (err) {
            return json(res, 500, { ok: false, error: errorToMessage(err) });
          }
        }
        if (url === '/api/profiles' && method === 'DELETE') {
          const username = parseOrThrow(z.object({ username: z.string().min(1) }), body, 'username').username;
          const ok = await this.deps.store.removeProfile(username);
          return json(
            res,
            ok ? 200 : 404,
            ok ? { ok: true } : { ok: false, error: `Profile ${username} not found.` },
          );
        }
        if (url === '/api/workspace/pin' && method === 'POST') {
          const parsed = parseOrThrow(PinWorkspaceBodySchema, body, 'pin body');
          await this.deps.store.pinWorkspace(parsed.path, parsed.pinned);
          return json(res, 200, { ok: true });
        }
        if (url === '/api/workspace/remove' && method === 'POST') {
          const parsed = parseOrThrow(z.object({ path: z.string().min(1) }), body, 'remove workspace body');
          const ok = await this.deps.store.removeWorkspace(parsed.path);
          return json(res, ok ? 200 : 404, { ok });
        }
        if (url === '/api/workspace/confirm' && method === 'POST') {
          const token = parseOrThrow(z.object({ token: z.string().min(1) }), body, 'token').token;
          const ok = await this.deps.store.confirmRiskyWorkspace(token);
          return json(res, ok ? 200 : 404, { ok });
        }
        if (url === '/api/workspace/cancel' && method === 'POST') {
          const token = parseOrThrow(z.object({ token: z.string().min(1) }), body, 'token').token;
          this.deps.store.cancelRiskyWorkspace(token);
          return json(res, 200, { ok: true });
        }
        // ----- Trusted Publishing (OIDC) — Chapter 8.5 -----
        if (url === '/api/oidc/trust' && method === 'GET') {
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const pkg = query.get('package');
          if (!pkg) throw new Error('Invalid or missing package.');
          this.deps.log?.(`[oidc] GET trust: package=${pkg}`);
          const result = await this.listTrustCached(pkg);
          this.deps.log?.(`[oidc] GET trust: ${result.ok ? `ok (${result.configs.length} configs)` : `fail ${result.status} ${result.error}`}`);
          return json(res, result.ok ? 200 : result.status, result.ok ? { ok: true, configs: result.configs } : { ok: false, error: result.error, needsReauth: result.needsReauth });
        }
        if (url === '/api/oidc/trust' && method === 'POST') {
          const parsed = parseOrThrow(OidcTrustPostBodySchema, body, 'oidc trust body');
          this.deps.log?.(`[oidc] POST trust: package=${parsed.package} type=${parsed.config.type}`);
          const auth = await this.resolveTrustAuth();
          if (!authIsOk(auth)) return json(res, 401, authDeniedBody(auth));
          const result = await addTrustedPublisher(auth, parsed.package, parsed.config as import('safe-npm-sdk').TrustedPublisherConfigCreate);
          this.deps.log?.(`[oidc] POST trust: ${result.ok ? 'ok' : `fail ${result.status} ${result.error}`}`);
          this.invalidateTrust(parsed.package);
          return json(res, result.ok ? 200 : result.status, { ok: result.ok, error: result.error });
        }
        if (url === '/api/oidc/trust' && method === 'DELETE') {
          const parsed = parseOrThrow(OidcTrustDeleteBodySchema, body, 'oidc trust delete body');
          this.deps.log?.(`[oidc] DELETE trust: package=${parsed.package} uuid=${parsed.uuid}`);
          const auth = await this.resolveTrustAuth();
          if (!authIsOk(auth)) return json(res, 401, authDeniedBody(auth));
          const result = await removeTrustedPublisher(auth, parsed.package, parsed.uuid);
          this.deps.log?.(`[oidc] DELETE trust: ${result.ok ? 'ok' : `fail ${result.status} ${result.error}`}`);
          this.invalidateTrust(parsed.package);
          return json(res, result.ok ? 200 : result.status, { ok: result.ok, error: result.error });
        }
        return json(res, 404, { ok: false, error: 'not found' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error.';
        const status = message.startsWith('Invalid ') || message === 'Invalid backup bundle.' ? 400 : 500;
        return json(res, status, { ok: false, error: message });
      }
    }

    // Token delivery endpoint (Chapter 3.2.2 — URL hash injection at opentray
    // load time; this endpoint lets the SPA read its token once at boot).
    if (url === '/__token') {
      const authed = this.checkAuth(req);
      if (!authed) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: this.deps.webToken }));
      return;
    }

    // Static asset serving.
    const dir = this.deps.webuiDir;
    if (!existsSync(dir)) {
      res.writeHead(404);
      res.end('WebUI not built. Run `pnpm build:webui`.');
      return;
    }
    let file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!existsSync(file)) {
      // SPA fallback (client-side routing).
      file = path.join(dir, 'index.html');
    }
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': contentTypeFor(file) });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    const header = req.headers['authorization'] ?? '';
    if (header.startsWith('Bearer ') && header.slice(7) === this.deps.webToken) return true;
    const url = (req.url ?? '').split('?')[0]!;
    const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    if (url === '/__token' && q.get('token') === this.deps.webToken) return true;
    return false;
  }

  // ----- WebSocket upgrade -----

  private handleUpgrade(req: http.IncomingMessage, socket: SocketLike): void {
    const accept = acceptWebSocket(req);
    if (!accept) {
      socket.destroy();
      return;
    }
    // Chapter 3.2.2 "瞬间拦截": the WebToken MUST be present in the upgrade
    // request (query string). Without it we refuse the handshake entirely — no
    // 101, no socket, no data. This is the transport-layer gate; the per-message
    // auth check in onMessage is the defense-in-depth backstop.
    const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const token = q.get('token') ?? '';
    if (token !== this.deps.webToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const ws = new WebSocketConnection(socket, {
      onOpen: (send) => {
        // Token already validated at upgrade time — mark authed immediately so
        // the eager state snapshot (events/profiles/workspaces) is only ever
        // sent to an authenticated client (Chapter 3.1 — never leak to unauthed).
        this.authedSockets.add(ws);
        send({ type: 'hello', webTokenRequired: true });
        send({ type: 'events', events: this.deps.store.getEvents() });
        send({
          type: 'profiles',
          default: this.deps.store.getDefault(),
          profiles: this.deps.store.getProfiles(),
        });
        send({ type: 'workspaces', workspaces: this.deps.store.getWorkspaces() });
      },
      onMessage: (msg, send) => {
        void this.handleClientMessage(msg, ws, send).catch((error: unknown) => {
          const message = errorToMessage(error);
          this.deps.log?.(`[ws] action failed: ${message}`);
          send({ type: 'toast', level: 'error', message });
        });
      },
      onClose: () => {
        this.sockets.delete(ws);
        this.authedSockets.delete(ws);
      },
    });
    this.sockets.add(ws);
    ws.ready();
  }

  private async handleClientMessage(
    msg: unknown,
    ws: WebSocketConnection,
    send: (data: unknown) => void,
  ): Promise<void> {
    if (!isWsClientMessage(msg)) {
      send({ type: 'toast', level: 'error', message: 'Invalid WebSocket message.' });
      return;
    }
    // Every action requires the WebToken (Chapter 3.2.2 强鉴权).
    if (msg.type === 'auth') {
      if (msg.webToken === this.deps.webToken) {
        this.authedSockets.add(ws);
        send({ type: 'toast', level: 'success', message: 'Authenticated.' });
      } else {
        send({ type: 'toast', level: 'error', message: 'Invalid WebToken.' });
      }
      return;
    }
    if (!this.authedSockets.has(ws)) {
      send({ type: 'toast', level: 'error', message: 'Unauthorized — send your WebToken first.' });
      return;
    }
    switch (msg.type) {
      case 'select-profile': {
        const selected = await this.deps.store.setDefault(msg.username);
        if (!selected) {
          send({ type: 'toast', level: 'error', message: `Profile "${msg.username}" not found.` });
          return;
        }
        this.broadcast({ type: 'workspaces', workspaces: this.deps.store.getWorkspaces() });
        break;
      }
      case 'confirm-event': {
        const ok = await this.deps.scheduler.confirm(msg.id);
        if (!ok) send({ type: 'toast', level: 'error', message: 'No such pending event.' });
        break;
      }
      case 'reject-event': {
        const ok = this.deps.scheduler.reject(msg.id);
        if (!ok) send({ type: 'toast', level: 'error', message: 'No such pending event.' });
        break;
      }
      case 'scan-workspace': {
        await this.scanWorkspace(msg.root, send);
        break;
      }
      case 'create-event': {
        this.createProactiveEvent(msg.kind, msg.payload, send, msg.groupId);
        break;
      }
      case 'update-event': {
        // Edit a pending publish / recursive-publish event's args before
        // confirmation. The store mutates the SAME PubEvent instance the
        // scheduler holds, so the edit is picked up live at confirm time. We
        // re-detect the git branch from the publish source on each update so
        // the publish-branch hint stays fresh (the user may have switched
        // branches while reviewing).
        const existing = this.deps.store.getEvent(msg.id);
        if (!existing || existing.status !== 'pending' || (existing.payload?.kind !== 'publish' && existing.payload?.kind !== 'recursive-publish')) {
          send({ type: 'toast', level: 'error', message: 'Only pending publish events can be edited.' });
          break;
        }
        const srcDir = existing.payload.data.source.kind === 'directory'
          ? existing.payload.data.source.path
          : path.dirname(existing.payload.data.source.path);
        existing.payload.data.branch = await this.detectGitBranch(srcDir);
        this.deps.store.updateEventArgs(msg.id, msg.args);
        break;
      }
    }
  }

  /**
   * Detect the current git branch for a directory. Returns '' when the path is
   * not inside a git work tree, or git is unavailable — the caller treats an
   * empty result as "unknown branch". Used only to surface a hint in the UI's
   * publish-branch option; the scheduler's own preflight
   * (`checkPublishGitState`) is the authoritative gate, not this value.
   */
  private async detectGitBranch(dir: string): Promise<string> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('git', ['-C', dir, 'branch', '--show-current'], { maxBuffer: 1024 });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async scanWorkspace(root: string, send: (data: unknown) => void): Promise<void> {
    const { store } = this.deps;
    const found = await findProjectRoot(root, realFs);

    // Chapter 5.3.2 risk-boundary state machine. If no project marker is found,
    // or the resolved root is a broad/system directory, we DO NOT persist it.
    // Instead we stage it and surface a confirmation request; only an explicit
    // `/api/workspace/confirm` call writes it to workspaces.json.
    if (!found.root || isRiskyRoot(found.root, realFs)) {
      const target = found.root ?? root;
      const token = store.stageRiskyWorkspace({ path: target, pinned: false, addedAt: Date.now() });
      send({
        type: 'toast',
        level: 'warning',
        message:
          'No Git or NPM project markers found. Adding this directory may cause the OS to stall. ' +
          'Confirm in the tray to add it anyway (token staged).',
      });
      // Push a packages frame carrying the staged confirmation token so the UI
      // can render an explicit confirm affordance (Chapter 5.3.2).
      send({
        type: 'packages',
        root: target,
        packages: [],
        riskyConfirmationToken: token,
      });
      return;
    }

    await store.addWorkspace({ path: found.root, pinned: false, addedAt: Date.now() });
    // Chapter 5.3.4: honor .gitignore so build/coverage outputs etc. are excluded.
    const pkgs = await scanWorkspace(found.root, realFs, { root: found.root, respectGitignore: true });
    // Detect a pnpm workspace (pnpm-workspace.yaml present) so the UI can offer
    // a "Recursive Publish" action that runs `pnpm publish -r`.
    const workspaceGlobs = await readWorkspacePackages(found.root, realFs);
    const isPnpmWorkspace = workspaceGlobs !== null;
    send({
      type: 'packages',
      root: found.root,
      packages: pkgs.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        path: p.path,
        ...(p.repository ? { repository: p.repository } : {}),
        ...(p.publishConfig ? { publishConfig: p.publishConfig } : {}),
        publishable: isPublishableByProfile(p, store.getDefault()),
      })),
      ...(isPnpmWorkspace ? { isPnpmWorkspace } : {}),
    });
  }

  private async createProactiveEvent(kind: PubEvent['kind'], payload: unknown, send: (data: unknown) => void, groupId?: string): Promise<void> {
    const profile = this.deps.store.getDefault();
    if (!profile) {
      send({ type: 'toast', level: 'error', message: 'Select a profile first.' });
      return;
    }
    const result = await this.deps.scheduler.createProactiveEvent(kind, profile, payload, groupId);
    if (!result.ok) {
      send({ type: 'toast', level: 'error', message: result.error });
      return;
    }
    // For publish events, fill the current-branch hint from the source path so
    // the EventCard's publish-branch option can show it on first render (before
    // the user edits anything). Re-broadcast via updateEventArgs so the branch
    // is persisted alongside the args.
    if (result.event.payload?.kind === 'publish') {
      const src = result.event.payload.data.source;
      const srcDir = src.kind === 'directory' ? src.path : path.dirname(src.path);
      result.event.payload.data.branch = await this.detectGitBranch(srcDir);
      this.deps.store.updateEventArgs(result.event.id, result.event.payload.data.args);
    }
    send({ type: 'event', event: result.event });
    send({ type: 'toast', level: 'info', message: 'Pending event created — review it under Events.' });
  }

  /** Broadcast a server message to every authed socket. */
  private broadcast(msg: WsServerMessage): void {
    for (const ws of this.sockets) {
      if (this.authedSockets.has(ws)) ws.write(msg);
    }
  }

  /** URL hash the opentray host should load to inject the WebToken (Chapter 3.2.2). */
  webUiUrl(port: number): string {
    return `http://127.0.0.1:${port}/#token=${this.deps.webToken}`;
  }

  /** Log-safe WebUI URL: never serialize the lifecycle WebToken to disk. */
  webUiUrlRedacted(port: number): string {
    return `http://127.0.0.1:${port}/#token=<redacted>`;
  }

  // ----- JSON API handlers (Chapter 8.1 onboarding, 8.2 import/export, 6.2.4 renew) -----

  /** Add-profile / onboarding flow with graceful fallback (Chapter 8.1). */
  private async addProfile(body: {
    username: string;
    password: string;
    totpSecret: string;
    registry?: string;
    manualToken?: string;
  }): Promise<{ ok: boolean; needsManualToken?: boolean; error?: string }> {
    const registry = body.registry ?? 'https://registry.npmjs.org/';
    let token = body.manualToken;
    if (!token) {
      const res = await applyToken({
        registry,
        username: body.username,
        password: body.password,
        totpSecret: body.totpSecret,
      });
      if (!res.ok) {
        return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
      }
      token = res.token;
    }
    // Side-effect-free credential check before persisting: confirms the token
    // is valid AND the TOTP secret produces an accepted OTP. A bad token or a
    // wrong totpSecret is caught here rather than surfacing on the first publish.
    const verified = await verifyCredentials({ registry, token: token!, totpSecret: body.totpSecret });
    if (!verified.ok || !verified.check?.authValid || verified.check.otpValid === false) {
      const reason = verified.check?.message ?? verified.error ?? 'credential verification failed';
      return { ok: false, needsManualToken: verified.check?.authValid === false, error: reason };
    }
    // Chapter 4.1 / 8.1 consistency: persist keychain first, then profiles.json.
    // If the profiles.json write fails, roll back the keychain entries so we
    // never leave an orphaned credential with no profile to manage it.
    try {
      // Merged auth item: ONE keychain write holds token + totp + npm password
      // (password kept so an expired token can be silently re-minted later).
      const secrets: ProfileSecrets = {
        npm_token: token!,
        totp_secret: body.totpSecret,
        npm_pwd: body.password,
      };
      await setProfileSecrets(body.username, secrets);
      const identity = await lookupNpmProfileIdentity(body.username, registry, {
        token,
      });
      await this.deps.store.upsertProfile({
        username: body.username,
        registry,
        avatarUrl: identity.avatarUrl ?? undefined,
        authStatus: 'authenticated',
      });
    } catch (error: unknown) {
      const { deleteProfile } = await import('./keychain.js');
      await deleteProfile(body.username).catch(() => {});
      return { ok: false, error: `Failed to persist profile: ${errorToMessage(error)}` };
    }
    // Populate the in-memory credential pool immediately (incl. password).
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret: body.totpSecret, npmPwd: body.password });
    this.invalidateAuthProbe(body.username);
    return { ok: true };
  }

  /**
   * Renew / silent re-mint. The password is OPTIONAL: when omitted, the stored
   * `npm_pwd` (from the merged keychain item) is reused so a token can be
   * refreshed without re-prompting the user. If the stored password has changed
   * / no longer works (applyToken fails without `needsManualToken`), the profile
   * is marked `authStatus: 'unauthenticated'` so the WebUI forces re-auth.
   */
  private async renewProfile(body: {
    username: string;
    password?: string;
    registry?: string;
    manualToken?: string;
    totpSecret?: string;
  }): Promise<{ ok: boolean; needsManualToken?: boolean; error?: string }> {
    const profile = this.deps.store.getProfile(body.username);
    if (!profile) {
      return { ok: false, error: `Profile ${body.username} not found.` };
    }
    const creds = this.deps.store.getCredentials(body.username);
    const previousToken = creds?.token ?? null;
    // TOTP comes from the pool, else the merged keychain item (one read) —
    // never the legacy split items (would prompt + lack the password).
    const fallbackSecrets = creds?.totpSecret ? null : await getProfileSecrets(body.username);
    const previousTotpSecret = creds?.totpSecret ?? fallbackSecrets?.totp_secret ?? null;
    const incomingTotpSecret = body.totpSecret?.trim() || undefined;
    const totpSecret = previousTotpSecret ?? incomingTotpSecret;
    if (!totpSecret) {
      return { ok: false, error: `No TOTP secret loaded for ${body.username}.` };
    }
    // Resolve the password: explicit body first, then the stored npm_pwd.
    const storedSecrets = creds?.npmPwd ? null : await getProfileSecrets(body.username);
    const password = body.password ?? creds?.npmPwd ?? storedSecrets?.npm_pwd;
    const registry = body.registry ?? profile.registry ?? 'https://registry.npmjs.org/';
    let token = body.manualToken;
    if (!token) {
      if (!password) {
        // No password available anywhere → cannot silently re-mint; force re-auth.
        await this.deps.store.upsertProfile({ ...profile, authStatus: 'unauthenticated' });
        return { ok: false, error: `No stored password for ${body.username}; re-authenticate.` };
      }
      const res = await applyToken({
        registry,
        username: body.username,
        password,
        totpSecret,
      });
      if (!res.ok) {
        // Password rejected (not a rate-limit manual-token fallback) → it changed;
        // mark unauthenticated so the UI asks for the new password.
        if (!res.needsManualToken) {
          await this.deps.store.upsertProfile({ ...profile, authStatus: 'unauthenticated' });
        }
        return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
      }
      token = res.token;
    }
    // Side-effect-free credential check before persisting the new token: this
    // also validates manually-pasted tokens (which are otherwise unchecked until
    // the first publish). Old keychain state is untouched on failure.
    const verified = await verifyCredentials({ registry, token: token!, totpSecret });
    if (!verified.ok || !verified.check?.authValid || verified.check.otpValid === false) {
      const reason = verified.check?.message ?? verified.error ?? 'credential verification failed';
      return { ok: false, needsManualToken: verified.check?.authValid === false, error: reason };
    }
    try {
      // Re-write the merged auth item with the new token (keep password/totp).
      const secrets: ProfileSecrets = {
        npm_token: token!,
        totp_secret: incomingTotpSecret && incomingTotpSecret !== previousTotpSecret ? incomingTotpSecret : totpSecret,
        npm_pwd: password!,
      };
      await setProfileSecrets(body.username, secrets);
      const identity = await lookupNpmProfileIdentity(body.username, registry, {
        token,
      });
      await this.deps.store.upsertProfile({
        ...profile,
        registry,
        avatarUrl: identity.avatarUrl ?? profile.avatarUrl,
        authStatus: 'authenticated',
      });
    } catch (error: unknown) {
      await this.restoreRenewCredentialState(body.username, previousToken, previousTotpSecret);
      return { ok: false, error: `Failed to renew profile: ${errorToMessage(error)}` };
    }
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret, npmPwd: password });
    this.invalidateAuthProbe(body.username);
    // Record when this fresh token was minted so the AutoRenew scheduler's
    // proactive (time-based) strategy knows when the 2h session window closes.
    recordTokenCreatedAt(this.deps.store, body.username);
    return { ok: true };
  }

  /**
   * Resolve the active profile's token + TOTP secret for an authenticated read
   * (profile-detail / packages / trust / unpublish). Returns a three-state
   * result so callers can distinguish "no credentials at all" from "credentials
   * present but the token is no longer accepted by the registry":
   *
   * - `missing` — no default profile, or no stored token/TOTP at all.
   * - `expired` — a token exists but the liveness probe (`verifyCredentials`,
   *   a read-only `listTokens`) reported `authValid:false`. The profile's
   *   `authStatus` is flipped to `unauthenticated` (and broadcast via the store)
   *   so the WebUI routes the user to re-auth instead of retrying blindly.
   * - `ok` — token + TOTP + registry, ready to use.
   *
   * The liveness probe result is cached per-username for a short window
   * ({@link AUTH_PROBE_TTL_MS}); a transport-level probe failure is treated
   * conservatively as `ok` (don't kill a token on a transient network blip —
   * the real request will surface the genuine error if the token is actually
   * bad). The cache is cleared on any credential change (renew/add/import).
   */
  private async resolveTrustAuth(): Promise<ResolvedAuth> {
    const username = this.deps.store.getDefault();
    if (!username) {
      this.deps.log?.('[auth] resolveTrustAuth: no default profile');
      return { status: 'missing' };
    }
    const profile = this.deps.store.getProfile(username);
    const registry = profile?.registry ?? 'https://registry.npmjs.org/';
    const creds = this.deps.store.getCredentials(username);
    // Prefer the in-memory pool; otherwise read the MERGED keychain item once
    // (one auth prompt) and warm the pool for subsequent calls.
    let token: string;
    let totpSecret: string;
    if (creds?.token && creds.totpSecret) {
      token = creds.token;
      totpSecret = creds.totpSecret;
    } else {
      const secrets = await getProfileSecrets(username);
      if (!secrets) {
        this.deps.log?.(`[auth] resolveTrustAuth: no merged secrets for ${username}`);
        return { status: 'missing' };
      }
      token = secrets.npm_token;
      totpSecret = secrets.totp_secret;
      this.deps.store.setCredentials(username, { token, totpSecret, npmPwd: secrets.npm_pwd });
    }

    // Liveness probe — short-TTL cached so the read paths share one verdict.
    const cached = this.authProbeCache.get(username);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.authValid
        ? { status: 'ok', token, totpSecret, registry }
        : { status: 'expired' };
    }
    let authValid = true;
    try {
      const verified = await verifyCredentials({ registry, token, totpSecret });
      // The SDK folds 401/403 into `check.authValid === false`; transport errors
      // surface as `!ok` and are treated conservatively as "still valid".
      authValid = verified.ok ? (verified.check?.authValid ?? true) : true;
    } catch (e) {
      this.deps.log?.(`[auth] resolveTrustAuth: probe failed for ${username} (${errorToMessage(e)}); treating as valid`);
      authValid = true;
    }
    this.authProbeCache.set(username, { authValid, expiresAt: Date.now() + WebServer.AUTH_PROBE_TTL_MS });
    if (!authValid) {
      this.deps.log?.(`[auth] resolveTrustAuth: token for ${username} is no longer valid; flipping authStatus`);
      // Flip + broadcast so the WebUI offers re-auth. Only persist when the
      // profile actually changed to avoid spurious keychain/profiles writes.
      if (profile && profile.authStatus !== 'unauthenticated') {
        await this.deps.store.upsertProfile({ ...profile, authStatus: 'unauthenticated' });
      }
      return { status: 'expired' };
    }
    return { status: 'ok', token, totpSecret, registry };
  }

  /** Clear the liveness-probe cache for a profile (call on credential change). */
  private invalidateAuthProbe(username: string): void {
    this.authProbeCache.delete(username);
  }

  /**
   * List trusted publishers for a package, with 30s caching + in-flight dedup
   * (same package → share one promise). Mutating routes (add/remove) invalidate
   * the cached entry so the next list reflects the change.
   */
  private async listTrustCached(name: string): Promise<{ ok: true; configs: TrustedPublisherConfig[] } | { ok: false; status: number; error: string; needsReauth?: boolean }> {
    const cached = this.trustCache.get(name);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      const configs = await cached.promise;
      return { ok: true, configs };
    }
    const auth = await this.resolveTrustAuth();
    if (auth.status !== 'ok') {
      return auth.status === 'expired'
        ? { ok: false, status: 401, error: 'Token expired or no longer valid.', needsReauth: true }
        : { ok: false, status: 401, error: 'No active profile credentials for this operation.' };
    }
    const promise = listTrustedPublishers(auth, name).then((r) => (r.ok ? r.configs : Promise.reject(r)));
    this.trustCache.set(name, { promise, expiresAt: now + WebServer.TRUST_CACHE_TTL_MS });
    try {
      const configs = await promise;
      return { ok: true, configs };
    } catch (err) {
      // Rejection carries the structured failure object from listTrustedPublishers.
      this.trustCache.delete(name);
      const fail = err as { ok: false; status: number; error: string };
      return { ok: false, status: fail.status, error: fail.error };
    }
  }

  private invalidateTrust(name: string): void {
    this.trustCache.delete(name);
  }

  /**
   * Resolve the active profile's full published-package list (cached ~60s +
   * in-flight dedup), then apply a case-insensitive substring filter, a sort,
   * and pagination. The registry walk is the network-bound part; once cached,
   * filter/sort/slice are cheap so the WebUI can re-query freely.
   */
  private async listPackages(
    query: string,
    sort: 'date' | 'name',
    page: number,
    pageSize: number,
  ): Promise<
    | { ok: true; items: NpmPackage[]; total: number; page: number; pageSize: number }
    | { ok: false; status: number; error: string }
  > {
    const username = this.deps.store.getDefault();
    if (!username) return { ok: false, status: 401, error: 'No active profile.' };
    const profile = this.deps.store.getProfile(username);
    const registry = profile?.registry ?? 'https://registry.npmjs.org/';

    const cacheKey = `${username.toLowerCase()}@${registry}`;
    const now = Date.now();
    let entry = this.packagesCache.get(cacheKey);
    if (!entry || entry.expiresAt <= now) {
      const promise = listMaintainerPackages(username, registry).catch((err: unknown) => {
        // A failed walk shouldn't poison the cache slot for 60s.
        this.packagesCache.delete(cacheKey);
        throw err;
      });
      entry = { promise, expiresAt: now + WebServer.PACKAGES_CACHE_TTL_MS };
      this.packagesCache.set(cacheKey, entry);
    }
    let all: NpmPackage[];
    try {
      all = await entry.promise;
    } catch (err: unknown) {
      return { ok: false, status: 502, error: errorToMessage(err) };
    }

    // Filter (case-insensitive substring across name / description / keywords).
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((p) => {
          if (p.name.toLowerCase().includes(q)) return true;
          if (p.description && p.description.toLowerCase().includes(q)) return true;
          if (p.keywords.some((k) => k.toLowerCase().includes(q))) return true;
          return false;
        })
      : all;

    // Sort. `date` is newest-first (ISO-8601 sorts lexically); `name` ascends.
    const sorted =
      sort === 'name'
        ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
        : [...filtered].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

    const safePageSize = Math.max(1, Math.min(pageSize, 100));
    const safePage = Math.max(0, Math.min(page, Math.floor(sorted.length / Math.max(1, safePageSize))));
    const start = safePage * safePageSize;
    const items = sorted.slice(start, start + safePageSize);
    return { ok: true, items, total: sorted.length, page: safePage, pageSize: safePageSize };
  }

  /**
   * Resolve a single package's detail projection (packument + collaborators +
   * downloads), with ~60s caching + in-flight dedup keyed by `name@registry`.
   * Mirrors {@link listPackages}'s cache discipline: share one promise while
   * fresh, delete the slot on rejection so a transient failure isn't sticky.
   */
  private async listPackageDetailCached(name: string): Promise<PackageDetailResult> {
    const auth = await this.resolveTrustAuth();
    if (!authIsOk(auth)) {
      const denied = authDeniedBody(auth);
      return { ok: false, status: 401, error: denied.error };
    }
    const cacheKey = `${name.toLowerCase()}@${auth.registry}`;
    const now = Date.now();
    let entry = this.detailCache.get(cacheKey);
    if (!entry || entry.expiresAt <= now) {
      const promise = fetchPackageDetail(name, { token: auth.token, registry: auth.registry }).catch(
        (err: unknown) => {
          this.detailCache.delete(cacheKey);
          throw err;
        },
      );
      entry = { promise, expiresAt: now + WebServer.DETAIL_CACHE_TTL_MS };
      this.detailCache.set(cacheKey, entry);
    }
    try {
      return await entry.promise;
    } catch (err: unknown) {
      return { ok: false, status: 502, error: errorToMessage(err) };
    }
  }

  private async restoreRenewCredentialState(
    username: string,
    token: string | null,
    totpSecret: string | null,
  ): Promise<void> {
    if (token) {
      await Promise.resolve().then(() => setToken(username, token)).catch(() => {});
    } else {
      await Promise.resolve().then(() => deleteToken(username)).catch(() => {});
    }
    if (totpSecret) {
      await Promise.resolve().then(() => setTotpSecret(username, totpSecret)).catch(() => {});
    } else {
      await Promise.resolve().then(() => deleteTotpSecret(username)).catch(() => {});
    }
    if (token && totpSecret) {
      this.deps.store.setCredentials(username, { token, totpSecret });
    } else {
      this.deps.store.deleteCredentials(username);
    }
  }

  /** Export all profile secrets to an encrypted bundle (Chapter 8.2). */
  private async exportBundle(
    password: string,
  ): Promise<{ ok: boolean; bundle?: unknown; error?: string; skipped?: string[] }> {
    const secrets: Record<string, { token: string; totp: string }> = {};
    const skipped: string[] = [];
    for (const profile of this.deps.store.getProfiles()) {
      const creds = this.deps.store.getCredentials(profile.username);
      let token = creds?.token;
      let totpSecret = creds?.totpSecret;
      // Fall back to the MERGED keychain item (one read) — not the legacy split
      // items, which would prompt twice and still lack the password.
      if ((!token || !totpSecret)) {
        const s = await getProfileSecrets(profile.username);
        token = token ?? s?.npm_token;
        totpSecret = totpSecret ?? s?.totp_secret;
      }
      if (token && totpSecret) {
        secrets[profile.username] = { token, totp: totpSecret };
        // Warm the pool so subsequent reads don't hit keychain again.
        if (!creds) {
          this.deps.store.setCredentials(profile.username, { token, totpSecret });
        }
        continue;
      }
      // Chapter 8.2: warn when a configured profile has no complete credential
      // pair in either memory or OS keychain instead of silently omitting it.
      skipped.push(profile.username);
    }
    if (Object.keys(secrets).length === 0) {
      return { ok: false, error: 'No credentials loaded to export.' };
    }
    const bundle = exportBundle(secrets, password);
    return { ok: true, bundle, skipped: skipped.length ? skipped : undefined };
  }

  /** Import selected profiles from an encrypted bundle (Chapter 8.2). */
  private async importBundle(
    bundle: BackupBundle,
    password: string,
    usernames: string[],
  ): Promise<{ ok: boolean; imported?: string[]; error?: string }> {
    const decoded = importBundle(bundle, password);
    if (!decoded) return { ok: false, error: 'Decryption failed — wrong password or tampered file.' };
    const imported: string[] = [];
    for (const username of usernames) {
      const entry = decoded[username];
      if (!entry) continue;
      try {
        await setToken(username, entry.token);
        await setTotpSecret(username, entry.totp);
        // Imported backups have no npm password → mark unauthenticated so the
        // user re-auths (which then writes the merged item with the password).
        await this.deps.store.upsertProfile({ username, authStatus: 'unauthenticated' });
        this.deps.store.setCredentials(username, { token: entry.token, totpSecret: entry.totp });
        imported.push(username);
      } catch (error: unknown) {
        await this.rollbackImportedProfiles([...imported, username]);
        return { ok: false, error: `Failed to import profile ${username}: ${errorToMessage(error)}` };
      }
    }
    return { ok: true, imported };
  }

  private async rollbackImportedProfiles(usernames: string[]): Promise<void> {
    for (const username of usernames) {
      await Promise.resolve().then(() => deleteToken(username)).catch(() => {});
      await Promise.resolve().then(() => deleteTotpSecret(username)).catch(() => {});
      this.deps.store.deleteCredentials(username);
    }
  }
}

// ----- module-level HTTP helpers -----

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let bodyBuf: Buffer | null = null;
  try {
    for await (const chunk of req) {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
        continue;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) return {};
    bodyBuf = Buffer.concat(chunks);
    const parsed: unknown = JSON.parse(bodyBuf.toString('utf8'));
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  } finally {
    if (bodyBuf) burnBuffer(bodyBuf);
    for (const chunk of chunks) burnBuffer(chunk);
  }
}

// ---------------------------------------------------------------------------
// Zod-backed REST body + WS message parsers (replaces all hand-written read*/is* helpers)
// ---------------------------------------------------------------------------

const AddProfileBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpSecret: z.string().min(1),
  registry: z.string().optional(),
  manualToken: z.string().optional(),
});

const RenewProfileBodySchema = z.object({
  username: z.string().min(1),
  // password is OPTIONAL — when omitted, renewProfile uses the stored npm_pwd.
  password: z.string().optional(),
  registry: z.string().optional(),
  manualToken: z.string().optional(),
  totpSecret: z.string().optional(),
});

const ExportBodySchema = z.object({
  password: z.string().min(1),
});

const ImportBodySchema = z.object({
  bundle: BackupBundleSchema,
  password: z.string().min(1),
  usernames: z.array(z.string().min(1)),
});

const PinWorkspaceBodySchema = z.object({
  path: z.string().min(1),
  pinned: z.boolean(),
});

const PackagesQuerySchema = z.object({
  q: z.string().default(''),
  sort: z.enum(['date', 'name']).default('date'),
  page: z.coerce.number().int().nonnegative().default(0),
  pageSize: z.coerce.number().int().positive().default(25),
});

const EventsQuerySchema = z.object({
  scope: z.enum(['pending', 'history']).default('history'),
  name: z.string().optional(),
  q: z.string().default(''),
  group: z.string().optional(),
  page: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const OidcTrustPostBodySchema = z.object({
  package: z.string().min(1),
  // POST (create) uses the SDK's create schema (different from GET response).
  config: z.record(z.string(), z.unknown()),
});

const OidcTrustDeleteBodySchema = z.object({
  package: z.string().min(1),
  uuid: z.string().min(1),
});

function parseAddProfileBody(body: unknown): z.infer<typeof AddProfileBodySchema> {
  return parseOrThrow(AddProfileBodySchema, body, 'add-profile body');
}

function parseRenewProfileBody(body: unknown): z.infer<typeof RenewProfileBodySchema> {
  return parseOrThrow(RenewProfileBodySchema, body, 'renew body');
}

/** Validate with a Zod schema or throw an Error with a readable message. */
function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') ?? '?';
    throw new Error(`Invalid or missing ${label}: ${path} ${first?.message ?? ''}`);
  }
  return result.data;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentTypeFor(filePath: string): string {
  return MIME[path.extname(filePath)] ?? 'application/octet-stream';
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Type guard: `true` when {@link ResolvedAuth} carries usable credentials. Use
 * after `const auth = await resolveTrustAuth()` so TypeScript narrows `auth` to
 * the `ok` variant for the authenticated call that follows.
 *
 * @example
 * ```
 * const auth = await this.resolveTrustAuth();
 * if (!authIsOk(auth)) return json(res, 401, authDeniedBody(auth));
 * // auth is now { status:'ok', token, totpSecret, registry }
 * ```
 */
function authIsOk(auth: ResolvedAuth): auth is Extract<ResolvedAuth, { status: 'ok' }> {
  return auth.status === 'ok';
}

/**
 * Build the 401 denial body for a non-`ok` {@link ResolvedAuth}. The `expired`
 * case carries `needsReauth: true` so the WebUI routes the user to re-auth.
 */
function authDeniedBody(auth: ResolvedAuth): { ok: false; error: string; needsReauth?: boolean } {
  if (auth.status === 'expired') return { ok: false, error: 'Token expired or no longer valid.', needsReauth: true };
  return { ok: false, error: 'No active profile credentials for this operation.' };
}

function isWsClientMessage(value: unknown): value is WsClientMessage {
  return WsClientMessageSchema.safeParse(value).success;
}
