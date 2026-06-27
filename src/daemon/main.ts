/**
 * Daemon process entrypoint.
 *
 * This is the file the CLI spawns (detached) when no socket is listening
 * (Chapter 5.1.1 / 7.2.1). It boots the daemon and then blocks until the
 * process is signaled to exit.
 */
import { bootDaemon } from './index.js';
import { readPackageVersion } from '../shared/package-version.js';

bootDaemon({ cliVersion: readPackageVersion() })
  .then((handles) => {
    if (!handles) {
      // Another daemon beat us to the single-instance lock (Chapter 5.1.3).
      process.exit(0);
    }
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[daemon] fatal:', err);
    process.exit(1);
  });
