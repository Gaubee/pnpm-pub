/**
 * Development runner — boots the daemon in-process so the WebUI can be
 * exercised end-to-end without real NPM credentials.
 *
 * Usage: `pnpm dev` (builds the WebUI first, then runs this via tsx).
 *
 * What it does:
 *   1. bootDaemon() — brings up IPC + HTTP + WS + tray host.
 *   2. Prints the WebUI URL — open it in a browser (or via opentray) to test.
 *   3. Keeps the process alive; Ctrl-C stops cleanly.
 *
 * This is for local UX testing only. Add a profile in the UI before attempting
 * to publish against a real registry or a local Verdaccio instance.
 */
import { bootDaemon } from './index.js';
import { setHomeOverride } from '../shared/paths.js';
import path from 'node:path';
import os from 'node:os';

async function main(): Promise<void> {
  // Isolate dev state in its own home so we never touch real ~/.pnpm-pub.
  // Use a stable, short path so the macOS 104-char socket limit is respected
  // and so a separately-spawned CLI can agree on it via PNPM_PUB_HOME.
  const devHome = process.env.PNPM_PUB_HOME ?? path.join(os.tmpdir(), 'pnpm-pub-dev');
  setHomeOverride(devHome);
  // Propagate to child processes (the CLI we launch to test interception).
  process.env.PNPM_PUB_HOME = devHome;

  const handles = await bootDaemon({
    cliVersion: '0.1.0-dev',
    withTray: process.env.PNPM_PUB_DEV_NO_TRAY !== '1',
  });

  if (!handles) {
    // eslint-disable-next-line no-console
    console.error('[dev] Another daemon already holds the socket. Run `pnpm-pub stop` first.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  pnpm-pub dev server is up.                                     │
│                                                                 │
│  WebUI:   ${handles.web.webUiUrl(handles.port).padEnd(49)}│
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

}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[dev] fatal:', err);
  process.exit(1);
});
