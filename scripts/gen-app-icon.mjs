/**
 * Darwin application-icon builder (Chapter 6.4, opentray 0.15+ app identity).
 *
 * Delegates entirely to the shared OpenTray icon kernel (`@opentray/icon`):
 * one generator, one visual standard — figma-squircle tiling, explicit 72 DPI
 * density, the ten-tag ICNS representation set, and the macOS content-size
 * variant inside the 1024 canvas. Never hand-roll rounded corners or call
 * iconutil directly; that is exactly what the kernel centralizes.
 *
 * The committed artifact is `assets/app-icon.icns` (resolved by the daemon at
 * runtime and copied into `dist/assets` by the build). The ICO / Linux PNG /
 * manifest outputs land in the cache dir: Windows and Linux have no runtime
 * bundle-carrier path today, so they are not shipped.
 *
 * Re-run after editing assets/icon.svg:
 *   node scripts/gen-app-icon.mjs
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOpenTrayAppIcon } from "@opentray/icon";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "assets", "icon.svg");
const OUTPUT = join(ROOT, "assets", "app-icon.icns");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "pnpm-pub-app-icon");

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const metadata = await generateOpenTrayAppIcon({
    sourcePath: SOURCE,
    icnsOutputPath: OUTPUT,
    // Non-Darwin families are generated (the kernel always emits all three)
    // but kept in the cache: no runtime consumer ships today.
    outputPath: join(CACHE_DIR, "app-icon.png"),
    icoOutputPath: join(CACHE_DIR, "app-icon.ico"),
    linuxOutputDirectory: join(CACHE_DIR, "linux"),
    manifestOutputPath: join(CACHE_DIR, "app-icon.json"),
    cachePath: join(CACHE_DIR, "generation.json"),
  });
  const darwin = metadata.appIcon.find((asset) => asset.platform === "darwin");
  const source = darwin && darwin.source.type === "file" ? darwin.source.path : OUTPUT;
  console.log(
    `[gen-app-icon] assets/app-icon.icns rebuilt via @opentray/icon ${metadata.recipeVersion}`,
  );
  console.log(`[gen-app-icon] darwin asset: ${source}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
