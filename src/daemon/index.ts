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
import type { IpcStatusFrame } from '../shared/index.js';
import { daemonLogPath } from '../shared/paths.js';
import { trayIconForProfile } from './avatar.js';
import { getProfileSecrets } from './keychain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DaemonOptions {
  cliVersion: string;
  webuiDir?: string;
  port?: number;
  /** When false, skip tray mount (tests/headless). */
  withTray?: boolean;
  /**
   * When true, tray mount failures are surfaced as fatal dev errors instead of
   * silently degrading to headless mode.
   */
  strictTrayMount?: boolean;
  /** opentray package version, used to partition the local-broker runtime state. */
  packageVersion?: string;
  /**
   * The URL the tray webview window should load. In release this is the daemon's
   * own WebServer URL; in dev this is the vite dev server URL (so HMR works).
   * Defaults to the daemon's own WebServer URL.
   */
  webviewUrl?: string;
}

const WEB_TOKEN_PLACEHOLDER = '__PNPM_PUB_WEB_TOKEN__';

export interface DaemonHandles {
  store: DaemonStore;
  scheduler: PublishScheduler;
  web: WebServer;
  ipc: IpcServer;
  port: number;
  webToken: string;
  stop: (opts?: { exit?: boolean }) => Promise<void>;
}

/**
 * The tray + webview-window surfaces tryCreateTray() returns. Null when the
 * opentray runtime binding is unavailable (headless / CI / native addon
 * missing) so the daemon degrades to an IPC/HTTP/WS-only server.
 *
 * `EventfulTrayHandle & WebviewTrayCapability` is exactly what
 * `tray.extend(WebviewExt)` yields; `WebviewWindowHandle` is what
 * `createWebviewWindow` yields. We alias them here so the mount result reads as
 * product domain vocabulary rather than SDK internals.
 */
type MountedTray = OpentrayTray;
type BaseTray = Awaited<ReturnType<typeof import('opentray').createTray>>;

type TrayMountFailureStage =
  | 'runtime-binding'
  | 'tray-extend'
  | 'window-create'
  | 'window-show';

type TrayMountFailureKind =
  | 'unsupported-platform'
  | 'missing-native-package'
  | 'missing-webview-package'
  | 'tray-mount-failed'
  | 'window-show-failed';

interface TrayMountFailure {
  kind: TrayMountFailureKind;
  stage: TrayMountFailureStage;
  cause: unknown;
}

type TrayMount = {
  tray: MountedTray | null;
  window: OpentrayWindow | null;
  /** Stop the tray-placement watch (no-op when placement never started). */
  stopPlacement: () => void;
  failure?: TrayMountFailure;
};

export class TrayMountError extends Error {
  readonly kind: TrayMountFailureKind;
  readonly stage: TrayMountFailureStage;
  readonly cause: unknown;

  constructor(failure: TrayMountFailure) {
    super(
      formatTrayMountFailure(failure),
      failure.cause instanceof Error ? { cause: failure.cause } : undefined,
    );
    this.name = 'TrayMountError';
    this.kind = failure.kind;
    this.stage = failure.stage;
    this.cause = failure.cause;
  }
}

interface TrayMountContext {
  baseTray: BaseTray | null;
  tray: MountedTray | null;
  panel: OpentrayWindow | null;
  stage: TrayMountFailureStage;
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
      log(`unhandledRejection: ${errorToLogMessage(reason)}`);
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
    onStop: async () => {
      await daemonHandles?.stop();
    },
    onStart: async (profileOverride) => {
      if (profileOverride && store.getProfile(profileOverride)) {
        await store.setDefault(profileOverride);
        return true;
      }
      return !profileOverride;
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
    log: (line) => log(line),
  });
  const port = await web.start(opts.port ?? 0);

  // Populate the credential pool from the keychain (Chapter 3.1 / 5.1).
  await refreshCredentials(store);

  // AutoRenew scheduler: proactively re-mint NPM session tokens (2h lifetime)
  // for profiles with autoRenew enabled. Started after credentials are warm.
  const { AutoRenewScheduler } = await import('./auto-renew.js');
  const autoRenew = new AutoRenewScheduler({ store, log: (line) => log(line) });
  autoRenew.start();

  // Tray host (Chapter 6.4). We bind opentray's public createTray() directly;
  // when the runtime is unavailable (dev/headless) we still construct a
  // TrayHost with null handles so the KeepOnTop/flash state machine is
  // observable via the daemon log.
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
    const mounted = await tryCreateTray(
      resolveWebviewUrl(opts.webviewUrl, web.webUiUrl(port), webToken),
      opts.packageVersion ?? opts.cliVersion,
      (line) => log(line),
    );
    if (mounted.failure && opts.strictTrayMount) {
      await web.stop();
      await ipc.stop();
      throw new TrayMountError(mounted.failure);
    }
    trayHost = new TrayHost(store, mounted.tray, mounted.window, {
      title: 'pnpm-pub',
      log: (line) => log(line),
      openItemId: 1,
      keepOnTop: true,
      initialVisible: mounted.window !== null,
    });
    stopPlacement = mounted.stopPlacement;
  }
  log(`WebUI available at ${web.webUiUrlRedacted(port)}`);

  let stopping = false;
  const stop = async (stopOpts: { exit?: boolean } = {}): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // bootDaemon runs inside a worker (the main thread owns the visible runtime
    // host loop). The worker must NOT call process.exit on its own — tearing
    // down the IPC/socket/tray is enough; the host terminates the worker.
    const exit = stopOpts.exit ?? false;
    log(`daemon stop requested (exit=${String(exit)})`);
    scheduler.drainAll();
    autoRenew.stop();
    stopPlacement?.();
    await trayHost?.destroy();
    await web.stop();
    await ipc.stop();
    store.close(); // flush + close the persisted event database
    if (exit) process.exit(0);
  };

  const daemonHandles: DaemonHandles = { store, scheduler, web, ipc, port, webToken, stop };

  process.on('SIGINT', () => {
    log('received SIGINT — stopping daemon');
    void stop();
  });
  process.on('SIGTERM', () => {
    log('received SIGTERM — stopping daemon');
    void stop();
  });

  return daemonHandles;
}

/**
 * Pull every profile's secrets from the MERGED keychain item into the in-memory
 * pool (Chapter 3.1 runtime phase). Only the merged `pnpm_pub-key<user>-auth`
 * item is read — ONE keychain prompt per profile. A profile without a merged
 * item is treated as not-yet-authenticated (the WebUI will force re-auth),
 * rather than falling back to the legacy split items (which would double the
 * keychain prompts and still lack the stored password).
 */
export async function refreshCredentials(store: DaemonStore): Promise<void> {
  store.clearCredentials();
  for (const profile of store.getProfiles()) {
    const secrets = await getProfileSecrets(profile.username);
    if (secrets) {
      store.setCredentials(profile.username, {
        token: secrets.npm_token,
        totpSecret: secrets.totp_secret,
        npmPwd: secrets.npm_pwd,
      });
    }
    // No merged item → leave pool empty for this profile; its authStatus stays
    // 'unauthenticated' so the UI re-prompts for the password (which then
    // writes the merged item). We deliberately do NOT read the legacy split
    // items here.
  }
}

function resolveWebviewUrl(webviewUrl: string | undefined, fallbackUrl: string, webToken: string): string {
  return webviewUrl?.replace(WEB_TOKEN_PLACEHOLDER, encodeURIComponent(webToken)) ?? fallbackUrl;
}

function log(message: string): void {
  try {
    fs.appendFileSync(daemonLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* best effort */
  }
  if (isDevRuntime()) {
    // eslint-disable-next-line no-console
    console.error(`[daemon] ${message}`);
  }
}

function isDevRuntime(): boolean {
  return Boolean(
    process.env.PNPM_PUB_DEV_SUPERVISOR_PID ||
      process.env.PNPM_PUB_DEV_DAEMON_PORT ||
      process.env.PNPM_PUB_DEV_WEBVIEW_URL,
  );
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
  packageVersion: string,
  log: (line: string) => void,
): Promise<TrayMount> {
  let baseTray: BaseTray | null = null;
  let tray: MountedTray | null = null;
  let panel: OpentrayWindow | null = null;
  let stopPlacement: (() => void) | undefined;
  try {
    // opentray 0.10 tray-first model: createTray() is the public creation
    // entrypoint and owns local-broker transport selection. pnpm-pub only
    // declares the tray atom and runtime identity.
    const opentray = await import('opentray');
    const ext = await import('@opentray/ext-webview');

    // trayOptions is typed by createTray's own parameter (TrayOptions from
    // @opentray/spec) via inference, so we don't need a direct spec dep.
    const trayOptions: Parameters<typeof opentray.createTray>[0] = {
      id: 'pnpm-pub',
      tooltip: { title: 'pnpm-pub', description: 'pnpm publish companion' },
      menu: { items: [{ type: 'item', id: 1, title: 'Open pnpm-pub', primaryEvent: true }] },
    };
    const icon = iconPath();
    if (icon && fs.existsSync(icon)) trayOptions.icon = { type: 'file', path: icon };

    baseTray = await opentray.createTray(trayOptions, {
      packageVersion,
      appId: 'com.pnpm-pub',
      appName: 'pnpm-pub',
    });
    tray = baseTray.extend(ext.WebviewExt);

    // Bootstrap the single tray-scoped window session ONCE. Overlay chrome keeps
    // the OS control cluster while the page owns the titlebar drag area; the
    // native semantic-blur material supplies the gaussian background, and
    // nativeWindowApi exposes navigator.opentrayWindow for startAppRegionDrag.
    panel = tray.createWebviewWindow({
      url,
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      title: 'pnpm-pub',
      nativeWindowApi: true,
      windowControlsOverlay: true,
      style: {
        keepOnTop: true,
        background: { kind: 'semantic', token: 'blur', state: 'active' },
      },
    });

    // Initial show so the window is visible on first tray mount (the panel is
    // created hidden; subsequent toggles go through tray-host show/hide).
    await panel.show();
    log('tray window shown on mount');

    // Anchor the panel to the tray after the native window exists. Placement is
    // projection behavior, so it must not query bounds before show() activates
    // the WebView window.
    stopPlacement = await startTrayPlacement(tray, panel, ext, log);

    log('opentray webview window mounted');
    return { tray, window: panel, stopPlacement };
  } catch (err) {
    const failure = classifyTrayMountFailure(err, {
      baseTray,
      tray,
      panel,
      stage: inferTrayMountFailureStage({ baseTray, tray, panel }),
    });
    await destroyMountedTray({ baseTray, tray, panel, stopPlacement });
    log(`opentray mount failed (${formatTrayMountFailure(failure)}) — running headless`);
    return { tray: null, window: null, stopPlacement: () => {}, failure };
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
  tray: MountedTray,
  panel: OpentrayWindow,
  ext: typeof import('@opentray/ext-webview'),
  log: (line: string) => void,
): Promise<() => void> {
  // Capability gate: placement needs tray bounds + screen details authorities.
  // Both come from the WebviewTrayCapability surface; if either is absent the
  // tray was created without webview placement support, so we skip anchoring.
  if (typeof tray.getBounds !== 'function' || typeof tray.getScreenDetails !== 'function') {
    log('placement authorities unavailable — window unanchored');
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
        watch.stop();
      } catch {
        /* placement teardown must never crash shutdown */
      }
    };
  } catch (err) {
    log(`placement watch failed (${errorToLogMessage(err)}) — window unanchored`);
    return () => {};
  }
}

function errorToLogMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Recurse into the cause chain — opentray wraps native resolution errors
  // (which list the candidate paths searched) several layers deep.
  const parts: string[] = [error.message];
  let cause = error.cause;
  let guard = 0;
  while (cause instanceof Error && guard < 5) {
    parts.push(`↳ ${cause.message}`);
    cause = (cause as Error).cause;
    guard++;
  }
  return parts.join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTrayMountFailure(failure: TrayMountFailure): string {
  return `[${failure.kind}@${failure.stage}] ${errorToLogMessage(failure.cause)}`;
}

function inferTrayMountFailureStage({
  baseTray,
  tray,
  panel,
}: Pick<TrayMountContext, 'baseTray' | 'tray' | 'panel'>): TrayMountFailureStage {
  if (panel !== null) return 'window-show';
  if (tray !== null) return 'window-create';
  if (baseTray !== null) return 'tray-extend';
  return 'runtime-binding';
}

function classifyTrayMountFailure(
  error: unknown,
  context: TrayMountContext,
): TrayMountFailure {
  const stage = context.stage;
  if (isMissingPlatformRuntimeBindingError(error)) {
    return {
      kind: isUnsupportedPlatformMessage(error.message)
        ? 'unsupported-platform'
        : 'missing-native-package',
      stage,
      cause: error,
    };
  }
  if (isWebviewExtensionLoadError(error)) {
    return {
      kind: isUnsupportedPlatformMessage(error.message)
        ? 'unsupported-platform'
        : 'missing-webview-package',
      stage,
      cause: error,
    };
  }
  if (stage === 'window-show') {
    return { kind: 'window-show-failed', stage, cause: error };
  }
  if (stage === 'window-create') {
    return { kind: 'missing-webview-package', stage, cause: error };
  }
  if (stage === 'tray-extend') {
    return { kind: 'tray-mount-failed', stage, cause: error };
  }
  return { kind: 'missing-native-package', stage, cause: error };
}

function isMissingPlatformRuntimeBindingError(
  error: unknown,
): error is { message: string; code?: string } {
  return isRecord(error) && error.code === 'OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING' && typeof error.message === 'string';
}

function isWebviewExtensionLoadError(
  error: unknown,
): error is { message: string; code?: string } {
  return isRecord(error) && error.code === 'webview_extension_load_failed' && typeof error.message === 'string';
}

function isUnsupportedPlatformMessage(message: string): boolean {
  return (
    message.includes('unsupported OpenTray runtime platform') ||
    message.includes('unsupported OpenTray runtime architecture') ||
    message.includes('Linux is unsupported for this extension')
  );
}

async function destroyMountedTray({
  baseTray,
  tray,
  panel,
  stopPlacement,
}: Pick<TrayMountContext, 'baseTray' | 'tray' | 'panel'> & {
  stopPlacement?: () => void;
}): Promise<void> {
  try {
    stopPlacement?.();
  } catch {
    /* placement teardown must never crash mount cleanup */
  }
  try {
    await panel?.destroy();
  } catch {
    /* window teardown must never crash mount cleanup */
  }
  const mountedTray = tray ?? baseTray;
  if (!mountedTray) return;
  try {
    await mountedTray.destroy();
  } catch {
    /* tray teardown must never crash mount cleanup */
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
      const avatar = trayIconForProfile(profile);
      if (avatar) return avatar;
    }
  }
  const plat = process.platform === 'darwin' ? 'macos' : 'windows';
  const name = pending ? `icon-${plat}-pending.png` : `icon-${plat}.png`;
  const candidates = [
    // Dev: the vite plugin rasterizes icons into a content-hash cache dir and
    // publishes it here, so the tray always uses fresh icons without touching
    // the working-tree assets/.
    process.env.PNPM_PUB_ICON_DIR ? path.join(process.env.PNPM_PUB_ICON_DIR, name) : null,
    path.join(__dirname, 'assets', name), // dist/assets (bundled)
    path.join(__dirname, '..', 'assets', name), // dev: src/daemon → <root>/assets
    path.join(process.cwd(), 'assets', name),
  ];
  return candidates.find((c) => c !== null && fs.existsSync(c)) ?? null;
}

/** Set by bootDaemon so the module-level iconPath() knows the active profile. */
let activeProfileRef: string | undefined;
