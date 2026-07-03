import { defineConfig } from "vite-plus";
import path from "node:path";
import type { Plugin } from "vite-plus";

// E2E config (Chapter 10.3) — separate so unit tests can run without Verdaccio.
// Shares the .js->.ts source-rewrite plugin with the unit config.

function tsSourceExtensionPlugin(): Plugin {
  return {
    name: "rewrite-js-to-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith(".")) return null;
      if (!/\.(js|mjs)$/.test(source)) return null;
      const dir = path.dirname(importer);
      const withoutExt = source.replace(/\.(js|mjs)$/, "");
      const candidate = path.resolve(dir, `${withoutExt}.ts`);
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
  test: {
    environment: "node",
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
