/**
 * Unified Vite+ configuration (root).
 *
 * Consolidates the former split tooling:
 *   - `tsdown.config.ts` build pipeline  → `pack:` block below
 *   - format / lint / staged-hook config → `fmt:`, `lint:`, `staged:` blocks
 *
 * Build pipeline (Chapter 9) outputs two standalone entrypoints into `dist/`:
 *   - dist/cli.js      (the thin client bin)
 *   - dist/daemon.js   (the spawned daemon main)
 * Plus the keytar fat-package copy plugin (Chapter 9.2) which copies the
 * matching keytar package surface into dist/prebuilds/keytar/. `opentray` is
 * declared external (Chapter 9.2.1) so the host package manager installs its
 * native bits normally.
 */
import { defineConfig, type Plugin } from "vite-plus/pack";
import path from "node:path";
import {
  existsSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const TARGET_PLATFORMS = ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64"];

/** Copy @github/keytar prebuilds (native .node) AND its JS shim into the bundle (Chapter 9.2). */
function copyKeytarPrebuilds(): Plugin {
  return {
    name: "pnpm-pub/keytar-prebuilds",
    apply: () => "build",
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
function copyAssets(): Plugin {
  return {
    name: "pnpm-pub/assets",
    apply: () => "build",
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

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
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
    plugins: [copyKeytarPrebuilds(), copyAssets()],
    unbundle: false,
    minify: false,
    clean: true,
  },
});
