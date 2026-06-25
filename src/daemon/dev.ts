/**
 * Development runner — boots the daemon in-process and seeds a MOCK profile so
 * the WebUI can be exercised end-to-end without real NPM credentials.
 *
 * Usage: `pnpm dev` (builds the WebUI first, then runs this via tsx).
 *
 * What it does:
 *   1. bootDaemon() — brings up IPC + HTTP + WS + tray host.
 *   2. Seeds a mock profile `dev-author` with throwaway credentials.
 *   3. Prints the WebUI URL — open it in a browser (or via opentray) to test.
 *   4. Keeps the process alive; Ctrl-C stops cleanly.
 *
 * This is for local UX testing only. The mock profile's credentials are not
 * valid against the real registry — point it at a local Verdaccio
 * (PNPM_PUB_DEV_REGISTRY) to test real publishes.
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

  // Seed a mock profile + throwaway credentials for UX testing.
  const registry = process.env.PNPM_PUB_DEV_REGISTRY ?? 'https://registry.npmjs.org/';
  await handles.store.upsertProfile({ username: 'dev-author', registry });
  handles.store.setCredentials('dev-author', {
    token: process.env.PNPM_PUB_DEV_TOKEN ?? 'dev-mock-token',
    totpSecret: process.env.PNPM_PUB_DEV_TOTP ?? 'JBSWY3DPEHPK3PXP',
  });
  await handles.store.setDefault('dev-author');

  // eslint-disable-next-line no-console
  console.log(`
┌─────────────────────────────────────────────────────────────────┐
│  pnpm-pub dev server is up.                                     │
│                                                                 │
│  WebUI:   ${handles.web.webUiUrl(handles.port).padEnd(49)}│
│  Profile: dev-author                                            │
│  Registry: ${registry.padEnd(48)}│
│                                                                 │
│  Open the WebUI URL in a browser to test the UI.                │
│  To test a publish interception, in another terminal run:       │
│    pnpm-pub publish   (in any project with a package.json)      │
│                                                                 │
│  Ctrl-C to stop.                                                │
└─────────────────────────────────────────────────────────────────┘
`);

  // Inject one demo pending event so the Events hub shows something on load.
  handles.store.createEvent({
    kind: 'publish',
    profile: 'dev-author',
    payload: {
      kind: 'publish',
      data: {
        cwd: process.cwd(),
        args: ['--access', 'public'],
        target: {
          name: '@dev-author/demo-pkg',
          version: '1.2.0',
          previousVersion: '1.1.4',
          description: 'A demo pending publish for UX testing.',
          path: process.cwd(),
        },
      },
    },
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[dev] fatal:', err);
  process.exit(1);
});
