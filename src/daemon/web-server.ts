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
import { acceptWebSocket, WebSocketConnection } from './ws.js';
import type { WsServerMessage, WsClientMessage, PubEvent } from '../shared/index.js';
import { findProjectRoot, scanWorkspace, filterByProfile, isRiskyRoot } from './workspace.js';
import { realFs } from './real-fs.js';
import { applyToken } from './npm-api.js';
import { setToken, setTotpSecret } from './keychain.js';
import { exportBundle, importBundle } from './crypto.js';

export interface WebServerDeps {
  store: DaemonStore;
  scheduler: PublishScheduler;
  webToken: string;
  webuiDir: string;
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

export class WebServer {
  private server?: http.Server;
  private sockets = new Set<WebSocketConnection>();
  private authedSockets = new WeakSet<WebSocketConnection>();

  constructor(private deps: WebServerDeps) {
    // Relay store events to every authed WebUI client.
    this.deps.store.on('event', (msg) => this.broadcast(msg));
    this.deps.store.on('profiles', (msg) => this.broadcast(msg));
    this.deps.store.on('workspaces', (msg) => this.broadcast(msg));
  }

  async start(port = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket as import('net').Socket));
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
        return json(res, 401, { ok: false, error: 'Unauthorized' });
      }
      try {
        const body = method !== 'GET' && method !== 'DELETE' ? await readJson(req) : {};
        if (url === '/api/add-profile' && method === 'POST') {
          const result = await this.addProfile(body);
          return json(res, 200, result);
        }
        if (url === '/api/renew' && method === 'POST') {
          const result = await this.addProfile(body);
          return json(res, 200, result);
        }
        if (url === '/api/export' && method === 'POST') {
          const result = await this.exportBundle(body.password);
          return json(res, 200, result);
        }
        if (url === '/api/import' && method === 'POST') {
          const result = await this.importBundle(body.bundle, body.password, body.usernames);
          return json(res, 200, result);
        }
        if (url === '/api/profiles' && method === 'DELETE') {
          await this.deps.store.removeProfile(body.username);
          return json(res, 200, { ok: true });
        }
        if (url === '/api/workspace/pin' && method === 'POST') {
          await this.deps.store.pinWorkspace(body.path, !!body.pinned);
          return json(res, 200, { ok: true });
        }
        if (url === '/api/workspace/confirm' && method === 'POST') {
          // Chapter 5.3.2: persist a previously-staged risky workspace.
          const ok = await this.deps.store.confirmRiskyWorkspace(body.token);
          return json(res, ok ? 200 : 404, { ok });
        }
        if (url === '/api/workspace/cancel' && method === 'POST') {
          this.deps.store.cancelRiskyWorkspace(body.token);
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { ok: false, error: 'not found' });
      } catch (err) {
        return json(res, 500, { ok: false, error: (err as Error).message });
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
      const ext = path.extname(file) as keyof typeof MIME;
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
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

  private handleUpgrade(req: http.IncomingMessage, socket: import('net').Socket): void {
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
    const ws = new WebSocketConnection(socket as unknown as import('net').Socket, {
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
      onMessage: (msg, send) => this.onMessage(msg as WsClientMessage, ws, send),
      onClose: () => {
        this.sockets.delete(ws);
        this.authedSockets.delete(ws);
      },
    });
    this.sockets.add(ws);
    ws.ready();
  }

  private async onMessage(
    msg: WsClientMessage,
    ws: WebSocketConnection,
    send: (data: unknown) => void,
  ): Promise<void> {
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
        await this.deps.store.setDefault(msg.username);
        break;
      }
      case 'confirm-event': {
        const ok = await this.deps.scheduler.confirm(msg.id);
        if (!ok) send({ type: 'toast', level: 'error', message: 'No such pending event.' });
        break;
      }
      case 'reject-event': {
        this.deps.scheduler.reject(msg.id);
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
      default: {
        // import/export are handled via REST-ish JSON endpoints (below).
        send({ type: 'toast', level: 'error', message: `Unsupported action: ${(msg as { type: string }).type}` });
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
    const scoped = filterByProfile(pkgs, store.getDefault());
    send({
      type: 'packages',
      root: found.root,
      packages: scoped.map((p) => ({ name: p.name, version: p.version, description: p.description, path: p.path })),
    });
  }

  private createProactiveEvent(kind: PubEvent['kind'], payload: unknown, send: (data: unknown) => void): void {
    const profile = this.deps.store.getDefault();
    if (!profile) {
      send({ type: 'toast', level: 'error', message: 'Select a profile first.' });
      return;
    }
    const evt = this.deps.store.createEvent({ kind, profile, payload: payload as never });
    send({ type: 'event', event: evt });
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
      await setToken(body.username, token!);
      await setTotpSecret(body.username, body.totpSecret);
      await this.deps.store.upsertProfile({
        username: body.username,
        registry,
      });
    } catch (err) {
      const { deleteProfile } = await import('./keychain.js');
      await deleteProfile(body.username).catch(() => {});
      return { ok: false, error: `Failed to persist profile: ${(err as Error).message}` };
    }
    // Populate the in-memory credential pool immediately.
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret: body.totpSecret });
    return { ok: true };
  }

  /** Export all profile secrets to an encrypted bundle (Chapter 8.2). */
  private async exportBundle(
    password: string,
  ): Promise<{ ok: boolean; bundle?: unknown; error?: string; skipped?: string[] }> {
    const secrets: Record<string, { token: string; totp: string }> = {};
    const skipped: string[] = [];
    for (const profile of this.deps.store.getProfiles()) {
      const creds = this.deps.store.getCredentials(profile.username);
      if (creds) {
        secrets[profile.username] = { token: creds.token, totp: creds.totpSecret };
      } else {
        // Chapter 8.2: warn when a configured profile has no loaded credentials
        // (e.g. keychain read failed at boot) instead of silently omitting it.
        skipped.push(profile.username);
      }
    }
    if (Object.keys(secrets).length === 0) {
      return { ok: false, error: 'No credentials loaded to export.' };
    }
    const bundle = exportBundle(secrets, password);
    return { ok: true, bundle, skipped: skipped.length ? skipped : undefined };
  }

  /** Import selected profiles from an encrypted bundle (Chapter 8.2). */
  private async importBundle(
    bundle: unknown,
    password: string,
    usernames: string[],
  ): Promise<{ ok: boolean; imported?: string[]; error?: string }> {
    const decoded = importBundle(bundle as Parameters<typeof importBundle>[0], password);
    if (!decoded) return { ok: false, error: 'Decryption failed — wrong password or tampered file.' };
    const imported: string[] = [];
    for (const username of usernames) {
      const entry = decoded[username];
      if (!entry) continue;
      await setToken(username, entry.token);
      await setTotpSecret(username, entry.totp);
      await this.deps.store.upsertProfile({ username });
      this.deps.store.setCredentials(username, { token: entry.token, totpSecret: entry.totp });
      imported.push(username);
    }
    return { ok: true, imported };
  }
}

// ----- module-level HTTP helpers -----

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}
