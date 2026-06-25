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
import { TrayHost, type OpentrayTray, type OpentrayWindow } from './tray-host.js';
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

  // Never let an async opentray/broker rejection (e.g. a webview command the
  // broker rejects mid-session, a stale SINGLE_SESSION) crash the daemon. Log
  // and continue so the IPC/HTTP/WS surfaces stay up and the WebUI is still
  // reachable in a browser even if the native window can't mount.
  process.on('unhandledRejection', (reason) => {
    try {
      log(`unhandledRejection: ${(reason as Error)?.message ?? reason}`);
    } catch {
      /* logging itself must never throw */
    }
  });

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
  let stopPlacement: (() => void) | undefined;
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
    const mounted = await tryCreateTray(web.webUiUrl(port), (line) => log(line));
    trayHost = new TrayHost(store, mounted.tray, mounted.window, {
      title: 'pnpm-pub',
      log: (line) => log(line),
      // Chapter 6.2.2: closing the tray window with pending events rejects them
      // so any suspended CLI exits instead of hanging.
      onWindowHidden: () => scheduler.drainAll(),
      openItemId: 1,
      // Pending signal is delivered by swapping to a badged icon (NOT by
      // mutating the title). opentray has no native badge API.
      baseIcon: iconPath(false) ?? undefined,
      pendingIcon: iconPath(true) ?? undefined,
      setIcon: (p) => {
        mounted.tray?.setIcon?.({ type: 'file', path: p });
      },
    });
    stopPlacement = mounted.stopPlacement;
  }
  log(`WebUI available at ${web.webUiUrl(port)}`);

  let stopping = false;
  const stop = async (opts: { exit?: boolean } = {}): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const exit = opts.exit ?? true;
    scheduler.drainAll();
    stopPlacement?.();
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
 * Implements the opentray skill's "Tray-Launched WebView Surface" +
 * "Tray-Anchored Lightweight Panel" + "Overlay Native Controls" scenario cards:
 *   const tray = (await createTray({ menu, primaryEvent })).extend(WebviewExt);
 *   const window = tray.createWebviewWindow({ url, windowControlsOverlay, ... });
 *   new WebviewPlacementKit({ tray, screen }).watch(window, { placement: "tray" });
 * and returns the real typed handles. The click→show wiring, KeepOnTop, blur
 * auto-hide, and flash live in TrayHost (the product behavior the skill leaves
 * to the app). This function owns only the opentray lifecycle: create tray,
 * extend, create ONE window session, keep the handle, anchor it to the tray.
 *
 * Window chrome choice: `windowControlsOverlay: true` keeps the OS
 * min/max/close cluster while letting page content occupy the titlebar area.
 * Per the skill (ext-webview.md "Overlay and Frameless Guidance") the page must
 * read `navigator.opentrayWindow.overlay.getTitlebarAreaRect()` and bind native
 * drag via `startAppRegionDrag()` itself — this host NEVER injects drag
 * CSS/titlebars. The semantic-blur background is the native material; the page
 * paints translucent so that blur shows through.
 *
 * Placement: `WebviewPlacementKit.watch(panel, { placement: "tray" })` anchors
 * the panel to tray geometry and re-applies after the window settles (quiescent
 * by design, so it never fights a user resize/move). The returned watch is
 * stopped on daemon shutdown.
 *
 * Per the skill (ext-webview.md): createWebviewWindow bootstraps ONCE; repeated
 * activations restore via show()/hide() and must NOT replay startup options.
 * The `icon` is optional; native icon support is `rgba` (skill
 * troubleshooting), so only a real .png is passed.
 *
 * Returns null handles when opentray/native webview is unavailable (headless /
 * CI) so TrayHost still runs observably against the log.
 */
async function tryCreateTray(
  url: string,
  log: (line: string) => void,
): Promise<{
  tray: OpentrayTray | null;
  window: OpentrayWindow | null;
  /** Stop the tray-placement watch (no-op when placement never started). */
  stopPlacement: () => void;
}> {
  try {
    const opentray = (await import('opentray')) as {
      createTray?: (options: unknown) => Promise<unknown>;
    };
    const ext = (await import('@opentray/ext-webview')) as {
      WebviewExt?: unknown;
      WebviewPlacementKit?: new (deps: {
        tray?: unknown;
        screen?: unknown;
      }) => {
        watch: (
          target: unknown,
          options: {
            placement: string;
            width: number;
            height: number;
            placementMargin?: number;
          },
        ) => Promise<{ stop?: () => void; unwatch?: () => void }>;
      };
    };
    if (typeof opentray.createTray !== 'function' || !ext.WebviewExt) {
      log('opentray/ext-webview not available — running headless');
      return { tray: null, window: null, stopPlacement: () => {} };
    }

    const trayOptions: Record<string, unknown> = {
      trayId: 'pnpm-pub',
      title: 'pnpm-pub',
      menu: { items: [{ type: 'item', id: 1, title: 'Open pnpm-pub', primaryEvent: true }] },
    };
    const icon = iconPath();
    if (icon && fs.existsSync(icon)) trayOptions.icon = { type: 'file', path: icon };

    // createTray → extend(WebviewExt) → TrayHandle & WebviewTrayCapability.
    const baseTray = await opentray.createTray(trayOptions);
    const tray = (
      typeof (baseTray as { extend?: (ext: unknown) => unknown }).extend === 'function'
        ? (baseTray as { extend(ext: unknown): unknown }).extend(ext.WebviewExt)
        : baseTray
    ) as OpentrayTray & {
      createWebviewWindow?(options: unknown): OpentrayWindow;
      getScreenDetails?(): Promise<unknown>;
    };

    // Bootstrap the single tray-scoped window session ONCE. Overlay chrome keeps
    // the OS control cluster while the page owns the titlebar drag area; the
    // native semantic-blur material supplies the gaussian background, and
    // nativeWindowApi exposes navigator.opentrayWindow for startAppRegionDrag.
    const panel = tray.createWebviewWindow?.({
      url,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      title: 'pnpm-pub',
      nativeWindowApi: true,
      windowControlsOverlay: true,
      style: {
        background: { kind: 'semantic', token: 'blur', state: 'active' },
      },
    });

    if (!panel) {
      log('createWebviewWindow unavailable — running headless');
      return { tray, window: null, stopPlacement: () => {} };
    }

    // Anchor the panel to the tray (skill "Tray-Anchored Lightweight Panel").
    // The kit consumes logical desktop pixels for the full Rect; tray bounds +
    // screen details come from the WebviewTrayCapability handle. watch() is
    // quiescent by default — it yields to user drag/resize and only re-applies
    // after the window settles, so it never fights a manual resize/move.
    const stopPlacement = await startTrayPlacement(tray, panel, ext, log);

    log('opentray webview window mounted');
    return { tray, window: panel, stopPlacement };
  } catch (err) {
    log(`opentray mount failed (${(err as Error).message}) — running headless`);
    return { tray: null, window: null, stopPlacement: () => {} };
  }
}

/** Tray panel geometry (logical desktop pixels). */
const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 560;

/**
 * Anchor a webview panel to the tray via WebviewPlacementKit. Returns a
 * stop() closure (best-effort: placement is a UX nicety, never fatal). When the
 * tray handle lacks placement authorities, or the watch rejects, we log and
 * return a no-op so the window still shows unanchored.
 */
async function startTrayPlacement(
  tray: {
    getBounds?: () => Promise<unknown>;
    getScreenDetails?: () => Promise<unknown>;
  } & OpentrayTray,
  panel: OpentrayWindow,
  ext: {
    WebviewPlacementKit?: new (deps: { tray?: unknown; screen?: unknown }) => {
      watch: (
        target: unknown,
        options: {
          placement: string;
          width: number;
          height: number;
          placementMargin?: number;
        },
      ) => Promise<{ stop?: () => void; unwatch?: () => void }>;
    };
  },
  log: (line: string) => void,
): Promise<() => void> {
  if (!ext.WebviewPlacementKit || typeof tray.getBounds !== 'function') {
    log('placement kit / tray bounds unavailable — window unanchored');
    return () => {};
  }
  try {
    const kit = new ext.WebviewPlacementKit({ tray, screen: tray });
    const watch = await kit.watch(panel, {
      placement: 'tray',
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      placementMargin: 8,
    });
    log('tray placement watch active');
    return () => {
      try {
        if (typeof watch.stop === 'function') watch.stop();
        else watch.unwatch?.();
      } catch {
        /* placement teardown must never crash shutdown */
      }
    };
  } catch (err) {
    log(`placement watch failed (${(err as Error).message}) — window unanchored`);
    return () => {};
  }
}

/**
 * Resolve the tray icon.
 *
 * macOS menubar items render as single-color "template" images, so we ship a
 * pure-black-on-transparent silhouette of the npm mark (`icon-macos.png`) that
 * composites correctly in either a light or dark menubar — its "n" is a real
 * alpha-0 cutout, not a white fill. Windows tray items are full-color, so we
 * ship the official npm red (`#c12127`) square (`icon-windows.png`). Both are
 * rasterized from the SVG source-of-truth in assets/ by `pnpm gen:icons`
 * (scripts/gen-icons.mjs, @resvg/resvg-js) into 64×64 rgba PNGs — opentray's
 * required icon format (@opentray/spec `Icon` type, `rgba`).
 *
 * A `pending` variant (same mark + a corner badge dot) signals an
 * awaiting-confirmation publish WITHOUT touching the title — opentray has no
 * native badge API, so we swap the icon file itself.
 *
 * If a cached user avatar exists it takes precedence for the base icon.
 */
function iconPath(pending = false): string | null {
  // Prefer a cached user avatar when present (base icon only; the avatar has no
  // badge variant, so pending still falls back to the npm mark + dot).
  if (!pending) {
    const profile = activeProfileRef;
    if (profile) {
      const { trayIconForProfile } = require('./avatar.js') as typeof import('./avatar.js');
      const avatar = trayIconForProfile(profile);
      if (avatar) return avatar;
    }
  }
  const plat = process.platform === 'darwin' ? 'macos' : 'windows';
  const name = pending ? `icon-${plat}-pending.png` : `icon-${plat}.png`;
  const candidates = [
    path.join(__dirname, 'assets', name), // dist/assets (bundled)
    path.join(__dirname, '..', 'assets', name), // dev: src/daemon → <root>/assets
    path.join(process.cwd(), 'assets', name),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Set by bootDaemon so the module-level iconPath() knows the active profile. */
let activeProfileRef: string | undefined;
