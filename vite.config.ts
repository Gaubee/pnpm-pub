/**
 * Unified Vite+ configuration (root).
 *
 * Consolidates the former split tooling:
 *   - `tsdown.config.ts` build pipeline → `pack:` block below
 *   - 3× `vitest*.config.ts`            → `test.projects` block below
 *   - format / lint / staged-hook config → `fmt:`, `lint:`, `staged:` blocks
 *
 * Core pack pipeline (Chapter 9) outputs two standalone entrypoints into `dist/`:
 *   - dist/cli.js      (the thin client bin)
 *   - dist/daemon.js   (the spawned daemon main)
 * Plus the keytar fat-package copy plugin (Chapter 9.2) which copies the
 * matching keytar package surface into dist/prebuilds/keytar/. `opentray` is
 * declared external (Chapter 9.2.1) so the host package manager installs its
 * native bits normally.
 *
 * The full `pnpm build` entrypoint lives in scripts/build/run.ts. It runs this
 * core pack atom and the SvelteKit WebUI atom concurrently, then stages
 * webui/build → dist/webui.
 *
 * NOTE on the two `Plugin` types: the `pack:` block uses Rolldown/tsdown
 * plugins (`closeBundle`, `apply`) from `vite-plus/pack`, while the test
 * projects use Vite plugins (`resolveId`, `enforce`) from `vite-plus`. They
 * are distinct shapes and are kept separate below.
 */
import { defineConfig, defineProject, type Plugin as VitePlugin } from "vite-plus";
import path from "node:path";
import { existsSync } from "node:fs";
import { corePackConfig } from "./scripts/build/core-config.js";

/**
 * Rewrite relative `.js`/`.mjs` import specifiers to their `.ts` source so the
 * daemon's ESM-style imports (e.g. `from '../../shared/index.js'`) resolve
 * under vitest where only the `.ts` file exists.
 *
 * Shared by the `unit` and `e2e` test projects below (formerly duplicated
 * across vitest.config.ts and vitest.e2e.config.ts).
 */
function tsSourceExtensionPlugin(): VitePlugin {
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
      if (!existsSync(candidate)) return null;
      return candidate;
    },
  };
}

export default defineConfig({
  staged: {
    "*": "vp check --fix",
    // Locale dictionary edits must keep full key parity + translation coverage
    // with en — surface drift at commit time, matching the CI strict gate so a
    // bad locale edit fails locally before it reaches CI.
    "webui/src/locales/**": "pnpm --filter ./webui i18n:check:strict",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  // Test config — 3 lanes consolidated from the former vitest.config.ts,
  // vitest.browser.config.ts, vitest.e2e.config.ts. `vp test` discovers them;
  // select with `--project unit|browser|e2e`.
  test: {
    projects: [
      // Unit lane — the default. Shared alias map + the .js→.ts rewrite plugin.
      defineProject({
        plugins: [tsSourceExtensionPlugin()],
        resolve: {
          alias: {
            "@pnpm-pub/shared": path.resolve(__dirname, "src/shared/index.ts"),
            // Allow webui tests to import $shared/schemas.js → src/shared/schemas.ts
            $shared: path.resolve(__dirname, "src/shared/"),
            // svelte-i18n lives in webui/node_modules; resolve it for daemon-side
            // tests that import webui modules which transitively use svelte-i18n.
            "svelte-i18n": path.resolve(
              __dirname,
              "webui/node_modules/svelte-i18n/dist/runtime.js",
            ),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**", "test/browser/**"],
          globals: false,
          testTimeout: 15_000,
        },
      }),
      // Browser lane — WebUI regressions that drive a real browser; lives
      // outside the unit lane because they may start dev servers.
      defineProject({
        test: {
          name: "browser",
          environment: "node",
          include: ["test/browser/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      }),
      // E2E lane — full interception loop against a mock registry; separate so
      // unit tests run without the heavier setup.
      defineProject({
        plugins: [tsSourceExtensionPlugin()],
        test: {
          name: "e2e",
          environment: "node",
          include: ["test/e2e/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      }),
    ],
  },
  pack: corePackConfig,
});
