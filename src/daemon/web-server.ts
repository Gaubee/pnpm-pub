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
import { findProjectRoot, scanWorkspace, isPublishableByProfile, isRiskyRoot } from './workspace.js';
import { realFs } from './real-fs.js';
import { applyToken } from './npm-api.js';
import { setToken, setTotpSecret, getToken, getTotpSecret, deleteToken, deleteTotpSecret, getProfileSecrets, setProfileSecrets, type ProfileSecrets } from './keychain.js';
import { exportBundle, importBundle } from './crypto.js';
import { burnBuffer } from './totp.js';
import { lookupNpmProfileIdentity } from './avatar.js';
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
        if (url === '/api/add-profile' && method === 'POST') {
          const result = await this.addProfile(parseAddProfileBody(body));
          return json(res, 200, result);
        }
        if (url === '/api/renew' && method === 'POST') {
          const result = await this.renewProfile(parseRenewProfileBody(body));
          return json(res, 200, result);
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
          return json(res, result.ok ? 200 : result.status, result.ok ? { ok: true, configs: result.configs } : { ok: false, error: result.error });
        }
        if (url === '/api/oidc/trust' && method === 'POST') {
          const parsed = parseOrThrow(OidcTrustPostBodySchema, body, 'oidc trust body');
          this.deps.log?.(`[oidc] POST trust: package=${parsed.package} type=${parsed.config.type}`);
          const auth = await this.resolveTrustAuth();
          if (!auth) return json(res, 401, { ok: false, error: 'No active profile credentials for this operation.' });
          const result = await addTrustedPublisher(auth, parsed.package, parsed.config as import('safe-npm-sdk').TrustedPublisherConfigCreate);
          this.deps.log?.(`[oidc] POST trust: ${result.ok ? 'ok' : `fail ${result.status} ${result.error}`}`);
          this.invalidateTrust(parsed.package);
          return json(res, result.ok ? 200 : result.status, { ok: result.ok, error: result.error });
        }
        if (url === '/api/oidc/trust' && method === 'DELETE') {
          const parsed = parseOrThrow(OidcTrustDeleteBodySchema, body, 'oidc trust delete body');
          this.deps.log?.(`[oidc] DELETE trust: package=${parsed.package} uuid=${parsed.uuid}`);
          const auth = await this.resolveTrustAuth();
          if (!auth) return json(res, 401, { ok: false, error: 'No active profile credentials for this operation.' });
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
        this.createProactiveEvent(msg.kind, msg.payload, send);
        break;
      }
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
    });
  }

  private createProactiveEvent(kind: PubEvent['kind'], payload: unknown, send: (data: unknown) => void): void {
    const profile = this.deps.store.getDefault();
    if (!profile) {
      send({ type: 'toast', level: 'error', message: 'Select a profile first.' });
      return;
    }
    const result = this.deps.scheduler.createProactiveEvent(kind, profile, payload);
    if (!result.ok) {
      send({ type: 'toast', level: 'error', message: result.error });
      return;
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
    return { ok: true };
  }

  /**
   * Resolve the active profile's token + TOTP secret for an npm `/trust` call.
   * The credentials pool is the fast path; keychain is the fallback (mirrors
   * `renewProfile`). Returns null when there is no active profile or no token.
   */
  private async resolveTrustAuth(): Promise<{ token: string; totpSecret: string; registry: string } | null> {
    const username = this.deps.store.getDefault();
    if (!username) {
      this.deps.log?.('[oidc] resolveTrustAuth: no default profile');
      return null;
    }
    const profile = this.deps.store.getProfile(username);
    const registry = profile?.registry ?? 'https://registry.npmjs.org/';
    const creds = this.deps.store.getCredentials(username);
    // Prefer the in-memory pool; otherwise read the MERGED keychain item once
    // (one auth prompt) and warm the pool for subsequent calls.
    if (creds?.token && creds.totpSecret) {
      return { token: creds.token, totpSecret: creds.totpSecret, registry };
    }
    const secrets = await getProfileSecrets(username);
    if (!secrets) {
      this.deps.log?.(`[oidc] resolveTrustAuth: no merged secrets for ${username}`);
      return null;
    }
    this.deps.store.setCredentials(username, { token: secrets.npm_token, totpSecret: secrets.totp_secret, npmPwd: secrets.npm_pwd });
    return { token: secrets.npm_token, totpSecret: secrets.totp_secret, registry };
  }

  /**
   * List trusted publishers for a package, with 30s caching + in-flight dedup
   * (same package → share one promise). Mutating routes (add/remove) invalidate
   * the cached entry so the next list reflects the change.
   */
  private async listTrustCached(name: string): Promise<{ ok: true; configs: TrustedPublisherConfig[] } | { ok: false; status: number; error: string }> {
    const cached = this.trustCache.get(name);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      const configs = await cached.promise;
      return { ok: true, configs };
    }
    const auth = await this.resolveTrustAuth();
    if (!auth) return { ok: false, status: 401, error: 'No active profile credentials for this operation.' };
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

function isWsClientMessage(value: unknown): value is WsClientMessage {
  return WsClientMessageSchema.safeParse(value).success;
}
