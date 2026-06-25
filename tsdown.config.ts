/**
 * tsdown build pipeline (Chapter 9).
 *
 * Outputs two standalone entrypoints into `dist/`:
 *   - dist/cli.js      (the thin client bin)
 *   - dist/daemon.js   (the spawned daemon main)
 *
 * Plus the keytar fat-package copy plugin (Chapter 9.2) which copies the
 * matching prebuilds into dist/prebuilds/keytar/. `opentray` is declared
 * external (Chapter 9.2.1) so the host package manager installs its native
 * bits normally.
 */
import { defineConfig, type Plugin } from 'tsdown';
import path from 'node:path';
import { existsSync, readdirSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const TARGET_PLATFORMS = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64'];

/** Copy @github/keytar prebuilds (native .node) AND its JS shim into the bundle (Chapter 9.2). */
function copyKeytarPrebuilds(): Plugin {
  return {
    name: 'pnpm-pub/keytar-prebuilds',
    apply: () => 'build',
    closeBundle() {
      const outDir = path.resolve(process.cwd(), 'dist');
      const destDir = path.join(outDir, 'prebuilds', 'keytar');
      mkdirSync(destDir, { recursive: true });

      // 1. Native prebuilds.
      const candidates = [
        path.join(process.cwd(), 'node_modules', '@github', 'keytar', 'prebuilds'),
        path.join(process.cwd(), 'node_modules', '@github', 'keytar', 'builds'),
      ];
      const prebuildsRoot = candidates.find((p) => existsSync(p));
      if (prebuildsRoot) {
        for (const platform of TARGET_PLATFORMS) {
          const dir = path.join(prebuildsRoot, platform);
          if (!existsSync(dir)) continue;
          for (const file of readdirSync(dir)) {
            if (file.endsWith('.node')) {
              copyFileSync(path.join(dir, file), path.join(destDir, `${platform}.node`));
            }
          }
        }
      }

      // 2. Inline the keytar JS shim (Chapter 9.2.2) so the daemon no longer
      //    depends on @github/keytar being present in node_modules at runtime —
      //    only the copied prebuilds matter.
      const keytarRoot = path.join(process.cwd(), 'node_modules', '@github', 'keytar');
      if (existsSync(keytarRoot)) {
        const pkg = JSON.parse(readFileSync(path.join(keytarRoot, 'package.json'), 'utf8')) as { main?: string };
        const jsEntry = pkg.main ? path.join(keytarRoot, pkg.main) : path.join(keytarRoot, 'index.js');
        if (existsSync(jsEntry)) {
          copyFileSync(jsEntry, path.join(destDir, 'keytar.js'));
        }
      }
    },
  };
}

export default defineConfig({
  entry: {
    cli: 'src/cli/cli.ts',
    daemon: 'src/daemon/main.ts',
  },
  outExtensions: () => ({ js: '.js' }),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Native/optional deps stay external so they resolve at runtime (Chapter
  // 9.2.1). opentray + ext-webview ship platform-specific native binaries that
  // must be installed by the host package manager, not inlined.
  deps: {
    neverBundle: ['opentray', '@opentray/ext-webview'],
  },
  plugins: [copyKeytarPrebuilds()],
  unbundle: false,
  minify: false,
  clean: true,
});
