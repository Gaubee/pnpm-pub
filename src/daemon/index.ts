/**
 * Daemon bootstrap & lifecycle (Chapter 5.1, 5.2, 6.4).
 *
 *  - Single-instance lock via the IPC socket (5.1.3)
 *  - Loads config + credentials into the in-memory pool (3.1, 5.1)
 *  - Brings up IPC + HTTP/WS servers (5.2)
 *  - Hosts the tray window via opentray (6.4)
 */
import { randomUUID } from 'node:crypto';
import { DaemonStore } from './store.js';
import { PublishScheduler } from './scheduler.js';
import { IpcServer } from './ipc-server.js';
import { WebServer } from './web-server.js';
import { randomHex } from './crypto.js';
import * as keychain from './keychain.js';
import { TrayHost, type TrayHandleLike, type TraySurfaceLike } from './tray-host.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyToken } from './npm-api.js';
import type {
  AddProfilePayload,
  AddProfileResult,
  IpcStatusFrame,
} from '../shared/index.js';
import { daemonLogPath } from '../shared/paths.js';
import { getToken, getTotpSecret, setToken, setTotpSecret } from './keychain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DaemonOptions {
  cliVersion: string;
  webuiDir?: string;
  port?: number;
  /** When false, skip the opentray host (tests/headless). */
  withTray?: boolean;
}

export interface DaemonHandles {
  store: DaemonStore;
  scheduler: PublishScheduler;
  web: WebServer;
  ipc: IpcServer;
  port: number;
  webToken: string;
  stop: () => Promise<void>;
}

/** Resolve the directory holding the built SvelteKit SPA (Chapter 5.2.2 / 9.1.1). */
function resolveWebuiDir(override?: string): string {
  if (override) return path.resolve(override);
  const candidates = [
    path.join(__dirname, 'webui'), // dist/webui (bundled layout)
    path.join(__dirname, '..', 'webui'), // dev / fallback
    path.join(process.cwd(), 'dist', 'webui'),
    path.join(process.cwd(), 'webui', 'build'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

/**
 * Boot the daemon. Returns the live handles, or null when another instance is
 * already running (single-instance lock, Chapter 5.1.3).
 */
export async function bootDaemon(opts: DaemonOptions): Promise<DaemonHandles | null> {
  const store = new DaemonStore();
  await store.load();

  // 5.1.3 single-instance lock.
  const webToken = randomHex(32); // 64-char hex (256-bit) — Chapter 3.2.2.
  const scheduler = new PublishScheduler(store);

  const ipc = new IpcServer({
    scheduler,
    cliVersion: opts.cliVersion,
    onStatus: () => ({ active: true, profile: store.getDefault(), pid: process.pid }),
    onStop: async () => daemonHandles?.stop(),
    onStart: async (profileOverride) => {
      if (profileOverride && store.getProfile(profileOverride)) {
        await store.setDefault(profileOverride);
      }
    },
  });

  const ipcOk = await ipc.start();
  if (!ipcOk) {
    // Another daemon is already holding the socket.
    return null;
  }

  const web = new WebServer({
    store,
    scheduler,
    webToken,
    webuiDir: resolveWebuiDir(opts.webuiDir),
  });
  const port = await web.start(opts.port ?? 0);

  // Populate the credential pool from the keychain (Chapter 3.1 / 5.1).
  await refreshCredentials(store);

  // Tray host (Chapter 6.4). We try to bind opentray's createTray; when it is
  // unavailable (dev/headless) we still construct a TrayHost with null handles
  // so the KeepOnTop/flash state machine is observable via the daemon log.
  let trayHost: TrayHost | null = null;
  if (opts.withTray !== false) {
    // Chapter 1.3.2 / 4.3: pre-fetch the active profile's avatar so the tray
    // icon is the NPM-logo + user-avatar merge (best-effort, cosmetic).
    const defaultProfile = store.getDefault();
    activeProfileRef = defaultProfile;
    if (defaultProfile) {
      const registry = store.getProfile(defaultProfile)?.registry ?? 'https://registry.npmjs.org/';
      const { fetchAndCacheAvatar } = await import('./avatar.js');
      await fetchAndCacheAvatar(defaultProfile, registry);
    }
    const { handle, surface } = await tryCreateTray(web.webUiUrl(port), (line) => log(line));
    trayHost = new TrayHost(store, handle, surface, {
      url: web.webUiUrl(port),
      title: 'pnpm-pub',
      log: (line) => log(line),
      // Chapter 6.2.2: closing the tray window with pending events rejects them
      // so any suspended CLI exits instead of hanging.
      onWindowHidden: () => scheduler.drainAll(),
    });
  }
  log(`WebUI available at ${web.webUiUrl(port)}`);

  let stopping = false;
  const stop = async (opts: { exit?: boolean } = {}): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const exit = opts.exit ?? true;
    scheduler.drainAll();
    await trayHost?.destroy();
    await web.stop();
    await ipc.stop();
    if (exit) process.exit(0);
  };

  const daemonHandles: DaemonHandles = { store, scheduler, web, ipc, port, webToken, stop };

  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());

  return daemonHandles;
}

/**
 * Pull every profile's token + TOTP secret from the keychain into the pool
 * (Chapter 3.1 runtime phase). Missing entries are silently skipped.
 */
export async function refreshCredentials(store: DaemonStore): Promise<void> {
  store.clearCredentials();
  for (const profile of store.getProfiles()) {
    const token = await getToken(profile.username);
    const totpSecret = await getTotpSecret(profile.username);
    if (token && totpSecret) {
      store.setCredentials(profile.username, { token, totpSecret });
    }
  }
}

/**
 * Onboarding flow (Chapter 8.1). Apply a token via NPM, burn the password, and
 * persist the resulting token + the user-supplied TOTP secret to the keychain.
 * On silent NPM rejection, return `needsManualToken` so the UI shows the
 * fallback paste box.
 */
export async function addProfile(payload: AddProfilePayload): Promise<AddProfileResult> {
  const registry = payload.registry ?? 'https://registry.npmjs.org/';
  const res = await applyToken({
    registry,
    username: payload.username,
    password: payload.password,
    totpSecret: payload.totpSecret,
  });
  if (!res.ok) {
    return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
  }
  await setToken(payload.username, res.token!);
  await setTotpSecret(payload.username, payload.totpSecret);
  return { ok: true };
}

function log(message: string): void {
  try {
    fs.appendFileSync(daemonLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* best effort */
  }
}

export { keychain };

/**
 * Mount the WebUI inside a real opentray WebView window (Chapter 6.4).
 *
 * Follows the canonical opentray recipe: create a tray, extend it with
 * `WebviewExt`, then `createWebviewWindow({ url, style })`. The returned
 * `WebviewWindowHandle` provides show/hide/setStyle({keepOnTop})/listen — which
 * map directly onto TrayHost's surface interface.
 *
 * The glass-shell style follows the opentray tray-panel rule: frameless +
 * keepOnTop, macOS `hudWindow` material, Windows `mica` + rounded corners.
 *
 * Returns null handles when opentray/native webview is unavailable (headless /
 * CI) so the TrayHost state machine still runs observably against the log.
 */
async function tryCreateTray(
  url: string,
  log: (line: string) => void,
): Promise<{ handle: TrayHandleLike | null; surface: TraySurfaceLike | null }> {
  try {
    const opentray = (await import('opentray')) as {
      createTray?: (options: unknown) => Promise<unknown>;
    };
    const ext = (await import('@opentray/ext-webview')) as {
      WebviewExt?: unknown;
    };
    if (typeof opentray.createTray !== 'function' || !ext.WebviewExt) {
      log('opentray/ext-webview not available — running headless');
      return { handle: null, surface: null };
    }

    // opentray skill scenario "Tray-Launched WebView Surface":
    //   const tray = (await createTray({...menu with primaryEvent...})).extend(WebviewExt);
    //   const window = tray.createWebviewWindow({ url/html, ... });
    //   tray.onMenuClick(({ itemId }) => { if (itemId === openId) window.show(); });
    // Keep the WebviewWindowHandle outside the click handler; repeated tray
    // clicks call show() on the SAME handle (never re-create or resend startup
    // size/style). The `icon` is optional; per skill troubleshooting, native
    // icon support is `rgba` — only pass a real .png when present.
    const trayOptions: Record<string, unknown> = {
      trayId: 'pnpm-pub',
      title: 'pnpm-pub',
      menu: { items: [{ type: 'item', id: 1, title: 'Open pnpm-pub', primaryEvent: true }] },
    };
    const icon = iconPath();
    if (icon && fs.existsSync(icon)) trayOptions.icon = { type: 'file', path: icon };
    const baseTray = await opentray.createTray(trayOptions);
    const tray = (
      typeof (baseTray as { extend?: (ext: unknown) => unknown }).extend === 'function'
        ? (baseTray as { extend(ext: unknown): unknown }).extend(ext.WebviewExt)
        : baseTray
    ) as TrayHandleLike & {
      createWebviewWindow?(options: unknown): WebviewWindowHandleLike;
      onMenuClick?(handler: (e: { itemId?: number }) => void): () => void;
    };

    // Bootstrap the single tray-scoped window session ONCE. Per the skill,
    // startup width/height/style run once; repeated activations restore via
    // show(). Glass-shell style uses the semantic blur token (skill canonical
    // form), frameless + keepOnTop, and the native window API so the page can
    // own its chrome (drag handled in-page, not injected here).
    const panel = tray.createWebviewWindow?.({
      url,
      width: 420,
      height: 640,
      title: 'pnpm-pub',
      nativeWindowApi: true,
      style: {
        frameless: true,
        keepOnTop: true,
        background: { kind: 'semantic', token: 'blur', state: 'active' },
      },
    });

    if (!panel) {
      log('createWebviewWindow unavailable — running headless');
      return { handle: tray, surface: null };
    }

    // The primary tray item opens the window (Chapter 6.4 — tray click → show).
    // Repeated clicks call show() on the same handle.
    tray.onMenuClick?.(({ itemId }) => {
      if (itemId === 1) void panel.show();
    });

    const surface: TraySurfaceLike = {
      show: () => panel.show(),
      hide: () => panel.hide(),
      setKeepOnTop: (on) => panel.setStyle({ keepOnTop: on }).then(() => {}, () => {}),
      onFocusLoss: (handler) => panel.listen('blur', () => handler()),
    };
    log('opentray webview window mounted');
    return { handle: tray, surface };
  } catch (err) {
    log(`opentray mount failed (${(err as Error).message}) — running headless`);
    return { handle: null, surface: null };
  }
}

/**
 * Resolve the tray icon for the active profile: the cached avatar (NPM logo +
 * user avatar merge, Chapter 1.3.2). Returns null when no avatar is cached so
 * the daemon creates a title-only tray (icon is optional end-to-end).
 */
function iconPath(): string | null {
  const profile = activeProfileRef;
  if (!profile) return null;
  const { trayIconForProfile } = require('./avatar.js') as typeof import('./avatar.js');
  return trayIconForProfile(profile);
}

/** Set by bootDaemon so the module-level iconPath() knows the active profile. */
let activeProfileRef: string | undefined;

/** Loose shape of opentray's WebviewWindowHandle (kept untyped to avoid coupling). */
interface WebviewWindowHandleLike {
  show(command?: unknown): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  setStyle(style: { frameless?: boolean; keepOnTop?: boolean; background?: unknown }): Promise<unknown>;
  listen(event: string, handler: () => void): () => void;
}
