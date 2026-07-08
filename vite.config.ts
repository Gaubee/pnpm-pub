/**
 * Unified Vite+ configuration (root).
 *
 * Consolidates the former split tooling:
 *   - `tsdown.config.ts` build pipeline → `pack:` block below
 *   - 3× `vitest*.config.ts`            → `test.projects` block below
 *   - format / lint / staged-hook config → `fmt:`, `lint:`, `staged:` blocks
 *
 * Build pipeline (Chapter 9) outputs two standalone entrypoints into `dist/`:
 *   - dist/cli.js      (the thin client bin)
 *   - dist/daemon.js   (the spawned daemon main)
 * Plus the keytar fat-package copy plugin (Chapter 9.2) which copies the
 * matching keytar package surface into dist/prebuilds/keytar/. `opentray` is
 * declared external (Chapter 9.2.1) so the host package manager installs its
 * native bits normally.
 *
 * NOTE on the two `Plugin` types: the `pack:` block uses Rolldown/tsdown
 * plugins (`closeBundle`, `apply`) from `vite-plus/pack`, while the test
 * projects use Vite plugins (`resolveId`, `enforce`) from `vite-plus`. They
 * are distinct shapes and are kept separate below.
 */
import { defineConfig, defineProject, type Plugin as VitePlugin } from "vite-plus";
// PackPlugin: the pack-time plugins below (closeBundle / apply) are Vite-plugin
// shaped. Imported from "vite-plus" (re-exported Vite Plugin, a supertype of
// rolldown's Plugin that also declares `apply`/`enforce`, which these plugins
// use) rather than "vite-plus/pack" — the latter resolves only through a
// 4-level `export *` chain that oxlint's type-check can't follow (false
// TS2305), and `vite-plus/prefer-vite-plus-imports` forbids bare `vite`.
// `tsc --noEmit` resolves all three paths identically.
import type { Plugin as PackPlugin } from "vite-plus";
import path from "node:path";
import {
  chmodSync,
  existsSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const TARGET_PLATFORMS = ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64"];
const CLI_BIN_SHEBANG = "#!/usr/bin/env node";

/** Copy @github/keytar prebuilds (native .node) AND its JS shim into the bundle (Chapter 9.2). */
function copyKeytarPrebuilds(): PackPlugin {
  return {
    name: "pnpm-pub/keytar-prebuilds",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(process.cwd(), "dist");
      const destRoot = path.join(outDir, "prebuilds", "keytar");
      mkdirSync(destRoot, { recursive: true });

      // 1. Native prebuilds.
      const candidates = [
        path.join(process.cwd(), "node_modules", "@github", "keytar", "prebuilds"),
        path.join(process.cwd(), "node_modules", "@github", "keytar", "builds"),
      ];
      const prebuildsRoot = candidates.find((p) => existsSync(p));
      if (prebuildsRoot) {
        for (const platform of TARGET_PLATFORMS) {
          const dir = path.join(prebuildsRoot, platform);
          if (!existsSync(dir)) continue;
          const destDir = path.join(destRoot, "prebuilds", platform);
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(dir)) {
            if (file.endsWith(".node")) {
              copyFileSync(path.join(dir, file), path.join(destDir, file));
            }
          }
        }
      }

      // 2. Inline the keytar JS shim (Chapter 9.2.2) so the daemon no longer
      //    depends on @github/keytar being present in node_modules at runtime —
      //    only the copied prebuilds matter.
      const keytarRoot = path.join(process.cwd(), "node_modules", "@github", "keytar");
      if (existsSync(keytarRoot)) {
        const pkg = JSON.parse(readFileSync(path.join(keytarRoot, "package.json"), "utf8")) as {
          main?: string;
        };
        writeFileSync(
          path.join(destRoot, "package.json"),
          JSON.stringify({ type: "commonjs", main: pkg.main ?? "index.js" }, null, 2),
          "utf8",
        );
        const jsEntry = pkg.main
          ? path.join(keytarRoot, pkg.main)
          : path.join(keytarRoot, "index.js");
        if (existsSync(jsEntry)) {
          const relativeEntry = pkg.main ?? "index.js";
          const destEntry = path.join(destRoot, relativeEntry);
          mkdirSync(path.dirname(destEntry), { recursive: true });
          copyFileSync(jsEntry, destEntry);
        }
      }
    },
  };
}

/**
 * Copy tray-icon assets into dist/assets (Chapter 9 build).
 *
 * PNGs come from the same content-hash cache the vite dev plugin uses
 * (scripts/gen-icons.mjs ensureIcons) so dev and release share one rasterized
 * artifact set — never re-rasterize when the SVGs + script are unchanged. SVG
 * sources are copied from assets/ as-is (they're committed sources, not cache).
 * This makes `gen:icons` optional in the build pipeline: copyAssets is
 * self-contained and produces the PNGs on demand.
 */
function copyAssets(): PackPlugin {
  return {
    name: "pnpm-pub/assets",
    apply: "build",
    async closeBundle() {
      const destDir = path.resolve(process.cwd(), "dist", "assets");
      mkdirSync(destDir, { recursive: true });

      // PNGs: resolve the cached rasterization (generates on miss).
      const { ensureIcons } = await import("./scripts/gen-icons.mjs");
      const cacheRoot = path.resolve(process.cwd(), "node_modules", ".cache", "pnpm-pub-icons");
      const { dir: iconDir, generated } = await ensureIcons({ cacheRoot, root: process.cwd() });
      if (generated) console.log(`[build] rasterized tray icons → ${iconDir}`);
      for (const file of readdirSync(iconDir)) {
        if (file.endsWith(".png")) {
          copyFileSync(path.join(iconDir, file), path.join(destDir, file));
        }
      }

      // SVGs: committed sources, copied as-is (favicon + design references).
      const assetsDir = path.resolve(process.cwd(), "assets");
      if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir)) {
          if (file.endsWith(".svg")) {
            copyFileSync(path.join(assetsDir, file), path.join(destDir, file));
          }
        }
      }
    },
  };
}

/**
 * Build the SvelteKit WebUI and stage it under dist/webui (Chapter 4.4.1).
 *
 * The WebUI is a separate Vite root (webui/vite.config.ts — SvelteKit +
 * adapter-static) so it cannot be bundled by the same `pack:` step. This plugin
 * shells out to its build, waits for it, then copies webui/build → dist/webui.
 * Run order is guaranteed by `closeBundle` firing after the core cli/daemon
 * chunks are written, so a single `vp pack` produces the full dist/.
 */
function buildWebui(): PackPlugin {
  return {
    name: "pnpm-pub/build-webui",
    apply: "build",
    async closeBundle() {
      const { execa } = await import("execa");
      console.log("[build] building WebUI (webui/ via vp build)…");
      await execa("pnpm", ["--filter", "./webui", "run", "build"], {
        cwd: process.cwd(),
        stdio: "inherit",
      });
      const src = path.resolve(process.cwd(), "webui", "build");
      const dest = path.resolve(process.cwd(), "dist", "webui");
      if (!existsSync(src)) {
        throw new Error(`[build] WebUI build output not found: ${src}`);
      }
      // Mirror the former `copy:webui` script: rm -rf dist/webui, copy fresh.
      await execa("rm", ["-rf", dest]);
      await execa("cp", ["-r", src, dest]);
      console.log(`[build] WebUI staged → ${path.relative(process.cwd(), dest)}`);
    },
  };
}

/** Enforce the npm `bin` contract: the shipped CLI must be directly executable. */
function enforceCliBinExecutable(): PackPlugin {
  return {
    name: "pnpm-pub/cli-bin-executable",
    apply: "build",
    closeBundle() {
      const cliBin = path.resolve(process.cwd(), "dist", "cli.js");
      if (!existsSync(cliBin)) {
        throw new Error(`[build] CLI bin output not found: ${cliBin}`);
      }

      const source = readFileSync(cliBin, "utf8");
      if (!source.startsWith(`${CLI_BIN_SHEBANG}\n`)) {
        throw new Error(`[build] CLI bin must start with ${CLI_BIN_SHEBANG}`);
      }

      chmodSync(cliBin, 0o755);
    },
  };
}

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
  pack: {
    entry: {
      cli: "src/cli/cli.ts",
      daemon: "src/daemon/main.ts",
    },
    outExtensions: () => ({ js: ".js" }),
    format: "esm",
    platform: "node",
    target: "node20",
    // Native/optional deps stay external so they resolve at runtime (Chapter
    // 9.2.1). opentray + ext-webview ship platform-specific native binaries
    // that must be installed by the host package manager, not inlined.
    deps: {
      neverBundle: ["opentray", "@opentray/ext-webview"],
    },
    plugins: [copyKeytarPrebuilds(), copyAssets(), buildWebui(), enforceCliBinExecutable()],
    unbundle: false,
    minify: false,
    clean: true,
  },
});
