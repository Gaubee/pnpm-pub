import { defineConfig } from "vite-plus";
import path from "node:path";
import type { Plugin } from "vite-plus";

/**
 * Rewrite relative `.js`/`.mjs` import specifiers to their `.ts` source so the
 * daemon's ESM-style imports (e.g. `from '../../shared/index.js'`) resolve under
 * vitest where only the `.ts` file exists.
 */
function tsSourceExtensionPlugin(): Plugin {
  return {
    name: "rewrite-js-to-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith(".")) return null;
      // Only rewrite explicit .js/.mjs specifiers — never .ts or extensionless.
      if (!/\.(js|mjs)$/.test(source)) return null;
      const dir = path.dirname(importer);
      const withoutExt = source.replace(/\.(js|mjs)$/, "");
      const candidate = path.resolve(dir, `${withoutExt}.ts`);
      // Only redirect when the .ts source actually exists.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("node:fs");
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
      "@pnpm-pub/shared": path.resolve(__dirname, "src/shared/index.ts"),
      // Allow webui tests to import $shared/schemas.js → src/shared/schemas.ts
      $shared: path.resolve(__dirname, "src/shared/"),
      // svelte-i18n lives in webui/node_modules; resolve it for daemon-side tests
      // that import webui modules which transitively use svelte-i18n.
      "svelte-i18n": path.resolve(__dirname, "webui/node_modules/svelte-i18n/dist/runtime.js"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "test/browser/**"],
    globals: false,
    testTimeout: 15_000,
  },
});
