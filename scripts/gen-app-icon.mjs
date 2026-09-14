/**
 * Darwin application-icon builder (Chapter 6.4, opentray 0.15+ app identity).
 *
 * Delegates entirely to the shared OpenTray icon kernel (`@opentray/icon`):
 * one generator, one visual standard — figma-squircle tiling, explicit 72 DPI
 * density, the ten-tag ICNS representation set, and the macOS content-size
 * variant inside the 1024 canvas. Never hand-roll rounded corners or call
 * iconutil directly; that is exactly what the kernel centralizes.
 *
 * Two stages, because the high-level `generateOpenTrayAppIcon` does not expose
 * the foreground inset scale (kernel default 0.8):
 *   1. `composeAppIcon` composes the tile at the owner-chosen scale
 *      (mark at 80% of its committed visual size, 2026-09-15) onto the
 *      pinned background, producing the full-canvas tile + macOS variant.
 *   2. `generateOpenTrayAppIcon({ composed: true })` passes those pixels
 *      through verbatim while applying the strict encoding standards
 *      (representation set, 72 DPI density, manifest, identity caching).
 *
 * The committed artifact is `assets/app-icon.icns` (resolved by the daemon at
 * runtime and copied into `dist/assets` by the build). The ICO / Linux PNG /
 * manifest outputs land in the cache dir: Windows and Linux have no runtime
 * bundle-carrier path today, so they are not shipped.
 *
 * Re-run after editing assets/icon.svg or FOREGROUND_SCALE:
 *   node scripts/gen-app-icon.mjs
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeAppIcon, generateOpenTrayAppIcon } from "@opentray/icon";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "assets", "icon.svg");
const OUTPUT = join(ROOT, "assets", "app-icon.icns");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "pnpm-pub-app-icon");

/**
 * Foreground inset ratio. The owner's ask is visual — the center mark at 80%
 * of its committed size — not a fraction of the kernel default 0.8: this
 * two-stage compose pipeline yields a smaller mark per unit scale than the
 * single-stage brand path that produced the committed icon (596px @ 0.76 vs
 * 702px committed). 0.716 lands the mark at ≈562px = 80% × 702px.
 */
const FOREGROUND_SCALE = 0.716;

/**
 * Pinned, not auto-picked: the kernel's single-stage auto selection chose
 * white for this artwork (the owner-approved tile), while `autoBackground`
 * over freshly sampled stats flips to black — two sampling paths disagree.
 * The tile color is part of the approved look, so it stays explicit here.
 */
const BACKGROUND = /** @type {const} */ ("white");

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  // Stage 1: kernel composition with the owner-chosen foreground scale.
  const composed = await composeAppIcon({
    foregroundPath: SOURCE,
    background: BACKGROUND,
    scale: FOREGROUND_SCALE,
    outputDir: join(CACHE_DIR, "composed"),
  });

  // Stage 2: strict asset-set generation from the pre-composed tiles.
  const metadata = await generateOpenTrayAppIcon({
    sourcePath: composed.compositePath,
    macosSourcePath: composed.macOSPath,
    composed: true,
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
  console.log(`[gen-app-icon] foreground scale ${FOREGROUND_SCALE} on ${BACKGROUND} tile`);
  console.log(`[gen-app-icon] darwin asset: ${source}`);
  console.log(`[gen-app-icon] preview: ${join(CACHE_DIR, "app-icon.png")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
