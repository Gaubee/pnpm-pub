/**
 * Development runner — boots the daemon in-process so the WebUI can be
 * exercised end-to-end without real NPM credentials.
 *
 * Usage: `pnpm dev` (runs the WebUI through Vite; no build/copy step).
 *
 * What it does:
 *   1. bootDaemon() — brings up IPC + HTTP + WS + tray host.
 *   2. Prints the WebUI URL — open it in a browser (or via opentray) to test it.
 *   3. Keeps the process alive; Ctrl-C stops cleanly.
 *
 * This is for local UX testing only. Add a profile in the UI before attempting
 * to publish against a real registry or a local Verdaccio instance.
 */
import os from 'node:os';
import path from 'node:path';

import { bootDaemon } from './index.js';
import { setHomeOverride } from '../shared/paths.js';
import { resolveDevTrayMode } from './dev-mode.js';

async function main(): Promise<void> {
  installDevProcessDiagnostics();
  // Isolate dev state in its own home so we never touch real ~/.pnpm-pub.
  // Use a stable, short path so the macOS 104-char socket limit is respected
  // and so a separately-spawned CLI can agree on it via PNPM_PUB_HOME.
  const devHome = process.env.PNPM_PUB_HOME ?? path.join(os.tmpdir(), 'pnpm-pub-dev');
  setHomeOverride(devHome);
  // Propagate to child processes (the CLI we launch to test interception).
  process.env.PNPM_PUB_HOME = devHome;
  const trayMode = resolveDevTrayMode(process.env, process.platform);
  if (trayMode.notice) {
    console.log(`[dev] ${trayMode.notice}`);
  }

  const handles = await bootDaemon({
    cliVersion: '0.1.0-dev',
    port: readOptionalPort(process.env.PNPM_PUB_DEV_DAEMON_PORT),
    webviewUrl: process.env.PNPM_PUB_DEV_WEBVIEW_URL,
    withTray: trayMode.withTray,
    strictTrayMount: trayMode.strictTrayMount,
  });

  if (!handles) {
    // eslint-disable-next-line no-console
    console.error('[dev] Another daemon already holds the socket. Run `pnpm-pub stop` first.');
    process.exit(0);
  }
  const stopSupervisorWatch = watchDevSupervisor(handles);

  // eslint-disable-next-line no-console
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  pnpm-pub dev server is up.                                     │
│                                                                 │
│  WebUI:   ${devWebUiUrl(handles).padEnd(49)}│
│  Profile: add one in the UI                                     │
│  Registry: n/a                                                  │
│                                                                 │
│  Open the WebUI URL in a browser to test the UI.                │
│  Add a profile in the UI, then run pnpm-pub publish             │
│  in a project with a package.json to test interception.         │
│                                                                 │
│  Ctrl-C to stop.                                                │
└─────────────────────────────────────────────────────────────────┘
`);

  process.once('exit', stopSupervisorWatch);
}

function installDevProcessDiagnostics(): void {
  process.once('exit', (code) => {
    console.error(`[dev] daemon process exit: code=${String(code)}`);
  });
  process.once('uncaughtException', (error) => {
    console.error('[dev] daemon uncaughtException:', error);
    process.exit(1);
  });
  process.once('unhandledRejection', (reason) => {
    console.error('[dev] daemon unhandledRejection:', reason);
  });
}

function readOptionalPort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PNPM_PUB_DEV_DAEMON_PORT: ${value}`);
  }
  return port;
}

function devWebUiUrl(handles: NonNullable<Awaited<ReturnType<typeof bootDaemon>>>): string {
  return process.env.PNPM_PUB_DEV_WEBVIEW_URL?.replace(
    '__PNPM_PUB_WEB_TOKEN__',
    encodeURIComponent(handles.webToken),
  ) ?? handles.web.webUiUrl(handles.port);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[dev] fatal:', err);
  process.exit(1);
});

function watchDevSupervisor(handles: NonNullable<Awaited<ReturnType<typeof bootDaemon>>>): () => void {
  const rawPid = process.env.PNPM_PUB_DEV_SUPERVISOR_PID;
  if (!rawPid) return () => {};
  const pid = Number.parseInt(rawPid, 10);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return () => {};

  const timer = setInterval(() => {
    if (isProcessAlive(pid)) return;
    clearInterval(timer);
    const forceExit = setTimeout(() => process.exit(0), 2_000);
    forceExit.unref?.();
    void handles.stop({ exit: true }).finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  }, 500);
  timer.unref?.();
  return () => clearInterval(timer);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'EPERM';
  }
}
