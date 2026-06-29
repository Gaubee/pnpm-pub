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
import type { BackupBundle, PubEvent, WsClientMessage, WsServerMessage } from '../shared/index.js';
import { findProjectRoot, scanWorkspace, filterByProfile, isRiskyRoot } from './workspace.js';
import { realFs } from './real-fs.js';
import { applyToken } from './npm-api.js';
import { setToken, setTotpSecret, getToken, getTotpSecret, deleteToken, deleteTotpSecret } from './keychain.js';
import { exportBundle, importBundle } from './crypto.js';
import { burnBuffer } from './totp.js';
import { lookupNpmProfileIdentity } from './avatar.js';

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

type JsonObject = Record<string, unknown>;

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
        return json(res, 401, { ok: false, error: 'Unauthorized' });
      }
      try {
        const body = method !== 'GET' ? await readJson(req) : {};
        if (url === '/api/npm-profile' && method === 'GET') {
          const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
          const result = await lookupNpmProfileIdentity(
            readQueryString(query, 'username'),
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
          const result = await this.exportBundle(readString(body, 'password'));
          return json(res, 200, result);
        }
        if (url === '/api/import' && method === 'POST') {
          const result = await this.importBundle(
            readBackupBundle(body, 'bundle'),
            readString(body, 'password'),
            readStringArray(body, 'usernames'),
          );
          return json(res, 200, result);
        }
        if (url === '/api/profiles' && method === 'DELETE') {
          const username = readString(body, 'username');
          const ok = await this.deps.store.removeProfile(username);
          return json(
            res,
            ok ? 200 : 404,
            ok ? { ok: true } : { ok: false, error: `Profile ${username} not found.` },
          );
        }
        if (url === '/api/workspace/pin' && method === 'POST') {
          await this.deps.store.pinWorkspace(readString(body, 'path'), readBoolean(body, 'pinned'));
          return json(res, 200, { ok: true });
        }
        if (url === '/api/workspace/confirm' && method === 'POST') {
          // Chapter 5.3.2: persist a previously-staged risky workspace.
          const ok = await this.deps.store.confirmRiskyWorkspace(readString(body, 'token'));
          return json(res, ok ? 200 : 404, { ok });
        }
        if (url === '/api/workspace/cancel' && method === 'POST') {
          this.deps.store.cancelRiskyWorkspace(readString(body, 'token'));
          return json(res, 200, { ok: true });
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
      onMessage: (msg, send) => this.handleClientMessage(msg, ws, send),
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
    const scoped = filterByProfile(pkgs, store.getDefault());
      send({
        type: 'packages',
        root: found.root,
        packages: scoped.map((p) => ({
          name: p.name,
          version: p.version,
          description: p.description,
          path: p.path,
          ...(p.repository ? { repository: p.repository } : {}),
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
      await setToken(body.username, token!);
      await setTotpSecret(body.username, body.totpSecret);
      const identity = await lookupNpmProfileIdentity(body.username, registry, { token });
      await this.deps.store.upsertProfile({
        username: body.username,
        registry,
        avatarUrl: identity.avatarUrl ?? undefined,
      });
    } catch (error: unknown) {
      const { deleteProfile } = await import('./keychain.js');
      await deleteProfile(body.username).catch(() => {});
      return { ok: false, error: `Failed to persist profile: ${errorToMessage(error)}` };
    }
    // Populate the in-memory credential pool immediately.
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret: body.totpSecret });
    return { ok: true };
  }

  /** Renew flow: reuse the stored TOTP secret instead of accepting an empty one. */
  private async renewProfile(body: {
    username: string;
    password: string;
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
    const previousTotpSecret = creds?.totpSecret ?? ((await getTotpSecret(body.username)) ?? null);
    const incomingTotpSecret = body.totpSecret?.trim() || undefined;
    const totpSecret = previousTotpSecret ?? incomingTotpSecret;
    if (!totpSecret) {
      return { ok: false, error: `No TOTP secret loaded for ${body.username}.` };
    }
    const registry = body.registry ?? profile.registry ?? 'https://registry.npmjs.org/';
    let token = body.manualToken;
    if (!token) {
      const res = await applyToken({
        registry,
        username: body.username,
        password: body.password,
        totpSecret,
      });
      if (!res.ok) {
        return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
      }
      token = res.token;
    }
    try {
      await setToken(body.username, token!);
      if (incomingTotpSecret && incomingTotpSecret !== previousTotpSecret) {
        await setTotpSecret(body.username, incomingTotpSecret);
      }
      const identity = await lookupNpmProfileIdentity(body.username, registry, { token });
      await this.deps.store.upsertProfile({
        ...profile,
        registry,
        avatarUrl: identity.avatarUrl ?? profile.avatarUrl,
      });
    } catch (error: unknown) {
      await this.restoreRenewCredentialState(body.username, previousToken, previousTotpSecret);
      return { ok: false, error: `Failed to renew profile: ${errorToMessage(error)}` };
    }
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret });
    return { ok: true };
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
      const token = creds?.token ?? (await getToken(profile.username));
      const totpSecret = creds?.totpSecret ?? (await getTotpSecret(profile.username));
      if (token && totpSecret) {
        secrets[profile.username] = { token, totp: totpSecret };
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
        await this.deps.store.upsertProfile({ username });
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

function parseAddProfileBody(body: JsonObject): {
  username: string;
  password: string;
  totpSecret: string;
  registry?: string;
  manualToken?: string;
} {
  return {
    username: readString(body, 'username'),
    password: readString(body, 'password'),
    totpSecret: readString(body, 'totpSecret'),
    registry: readOptionalString(body, 'registry'),
    manualToken: readOptionalString(body, 'manualToken'),
  };
}

function parseRenewProfileBody(body: JsonObject): {
  username: string;
  password: string;
  registry?: string;
  manualToken?: string;
  totpSecret?: string;
} {
  return {
    username: readString(body, 'username'),
    password: readString(body, 'password'),
    registry: readOptionalString(body, 'registry'),
    manualToken: readOptionalString(body, 'manualToken'),
    totpSecret: readOptionalString(body, 'totpSecret'),
  };
}

function readString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid or missing ${key}.`);
  }
  return value;
}

function readOptionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${key}.`);
  }
  return value;
}

function readQueryString(query: URLSearchParams, key: string): string {
  const value = query.get(key);
  if (!value) {
    throw new Error(`Invalid or missing ${key}.`);
  }
  return value;
}

function readBoolean(body: JsonObject, key: string): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid or missing ${key}.`);
  }
  return value;
}

function readStringArray(body: JsonObject, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`Invalid or missing ${key}.`);
  }
  return value;
}

function readBackupBundle(body: JsonObject, key: string): BackupBundle {
  const value = body[key];
  if (!isBackupBundle(value)) {
    throw new Error('Invalid backup bundle.');
  }
  return value;
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

const EVENT_KINDS: readonly string[] = [
  'publish',
  'setup-oidc',
  'create-placeholder',
  'refresh-token',
];

function isWsClientMessage(value: unknown): value is WsClientMessage {
  if (!isJsonObject(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'auth':
      return typeof value.webToken === 'string';
    case 'select-profile':
      return typeof value.username === 'string';
    case 'confirm-event':
    case 'reject-event':
      return typeof value.id === 'string';
    case 'scan-workspace':
      return typeof value.root === 'string';
    case 'create-event':
      return isEventKind(value.kind);
    default:
      return false;
  }
}

function isEventKind(value: unknown): value is PubEvent['kind'] {
  return typeof value === 'string' && EVENT_KINDS.includes(value);
}

function isBackupBundle(value: unknown): value is BackupBundle {
  return (
    isJsonObject(value) &&
    Array.isArray(value.profiles) &&
    value.profiles.every((profile) => typeof profile === 'string' && profile.length > 0) &&
    typeof value.salt === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string'
  );
}
