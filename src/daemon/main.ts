/**
 * Daemon process entrypoint.
 *
 * Used by the CLI `start` command (release) and by the vite dev plugin. This
 * file stays thin so the bundled `dist/daemon.js` entry remains a clean
 * process boundary.
 */
import { bootDaemon } from "./index.js";
import { readPackageVersion } from "../shared/package-version.js";

async function main(): Promise<void> {
  const cliVersion = readPackageVersion();
  const webviewUrl = process.env.PNPM_PUB_DEV_WEBVIEW_URL;
  const handles = await bootDaemon({ cliVersion, webviewUrl });
  if (!handles) {
    process.exit(0);
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
