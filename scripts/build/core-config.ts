import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { UserConfig } from "vite-plus/pack";
import type { Plugin } from "vite-plus";

const TARGET_PLATFORMS = ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64"];
const CLI_BIN_SHEBANG = "#!/usr/bin/env node";

/** Copy @github/keytar native prebuilds and its CommonJS shim into dist/. */
function copyKeytarPrebuilds(): Plugin {
  return {
    name: "pnpm-pub/keytar-prebuilds",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(process.cwd(), "dist");
      const destRoot = path.join(outDir, "prebuilds", "keytar");
      mkdirSync(destRoot, { recursive: true });

      const candidates = [
        path.join(process.cwd(), "node_modules", "@github", "keytar", "prebuilds"),
        path.join(process.cwd(), "node_modules", "@github", "keytar", "builds"),
      ];
      const prebuildsRoot = candidates.find((candidate) => existsSync(candidate));
      if (prebuildsRoot) {
        for (const platform of TARGET_PLATFORMS) {
          const dir = path.join(prebuildsRoot, platform);
          if (!existsSync(dir)) continue;
          const destDir = path.join(destRoot, "prebuilds", platform);
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(dir)) {
            if (file.endsWith(".node"))
              copyFileSync(path.join(dir, file), path.join(destDir, file));
          }
        }
      }

      const keytarRoot = path.join(process.cwd(), "node_modules", "@github", "keytar");
      if (!existsSync(keytarRoot)) return;
      const pkg = JSON.parse(readFileSync(path.join(keytarRoot, "package.json"), "utf8")) as {
        main?: string;
      };
      writeFileSync(
        path.join(destRoot, "package.json"),
        JSON.stringify({ type: "commonjs", main: pkg.main ?? "index.js" }, null, 2),
        "utf8",
      );
      const relativeEntry = pkg.main ?? "index.js";
      const jsEntry = path.join(keytarRoot, relativeEntry);
      if (!existsSync(jsEntry)) return;
      const destEntry = path.join(destRoot, relativeEntry);
      mkdirSync(path.dirname(destEntry), { recursive: true });
      copyFileSync(jsEntry, destEntry);
    },
  };
}

/** Copy tray icon assets into dist/assets, generating PNG cache entries on miss. */
function copyAssets(): Plugin {
  return {
    name: "pnpm-pub/assets",
    apply: "build",
    async closeBundle() {
      const destDir = path.resolve(process.cwd(), "dist", "assets");
      mkdirSync(destDir, { recursive: true });

      const { ensureIcons } = await import("../gen-icons.mjs");
      const cacheRoot = path.resolve(process.cwd(), "node_modules", ".cache", "pnpm-pub-icons");
      const { dir: iconDir, generated } = await ensureIcons({ cacheRoot, root: process.cwd() });
      if (generated) console.log(`[build] rasterized tray icons -> ${iconDir}`);
      for (const file of readdirSync(iconDir)) {
        if (file.endsWith(".png")) copyFileSync(path.join(iconDir, file), path.join(destDir, file));
      }

      const assetsDir = path.resolve(process.cwd(), "assets");
      if (!existsSync(assetsDir)) return;
      for (const file of readdirSync(assetsDir)) {
        if (file.endsWith(".svg"))
          copyFileSync(path.join(assetsDir, file), path.join(destDir, file));
      }
    },
  };
}

/** Enforce the npm bin contract after tsdown writes dist/cli.js. */
function enforceCliBinExecutable(): Plugin {
  return {
    name: "pnpm-pub/cli-bin-executable",
    apply: "build",
    closeBundle() {
      const cliBin = path.resolve(process.cwd(), "dist", "cli.js");
      if (!existsSync(cliBin)) throw new Error(`[build] CLI bin output not found: ${cliBin}`);

      const source = readFileSync(cliBin, "utf8");
      if (!source.startsWith(`${CLI_BIN_SHEBANG}\n`)) {
        throw new Error(`[build] CLI bin must start with ${CLI_BIN_SHEBANG}`);
      }

      chmodSync(cliBin, 0o755);
    },
  };
}

export const corePackConfig = {
  entry: {
    cli: "src/cli/cli.ts",
    daemon: "src/daemon/main.ts",
  },
  outExtensions: () => ({ js: ".js" }),
  format: "esm",
  platform: "node",
  target: "node20",
  deps: {
    neverBundle: ["opentray", "@opentray/ext-webview"],
  },
  plugins: [copyKeytarPrebuilds(), copyAssets(), enforceCliBinExecutable()],
  unbundle: false,
  minify: false,
  clean: true,
} satisfies UserConfig;
