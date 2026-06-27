import { defineConfig } from 'vitest/config';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Rewrite relative `.js`/`.mjs` import specifiers to their `.ts` source so the
 * daemon's ESM-style imports (e.g. `from '../../shared/index.js'`) resolve under
 * vitest where only the `.ts` file exists.
 */
function tsSourceExtensionPlugin(): Plugin {
  return {
    name: 'rewrite-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith('.')) return null;
      // Only rewrite explicit .js/.mjs specifiers — never .ts or extensionless.
      if (!/\.(js|mjs)$/.test(source)) return null;
      const dir = path.dirname(importer);
      const withoutExt = source.replace(/\.(js|mjs)$/, '');
      const candidate = path.resolve(dir, `${withoutExt}.ts`);
      // Only redirect when the .ts source actually exists.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('node:fs');
        if (!fs.existsSync(candidate)) return null;
      } catch {
        return null;
      }
      return candidate;
    },
  };
}

export default defineConfig({
  plugins: [tsSourceExtensionPlugin()],
  resolve: {
    alias: {
      '@pnpm-pub/shared': path.resolve(__dirname, 'src/shared/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**', 'test/browser/**'],
    globals: false,
    testTimeout: 15_000,
  },
});
