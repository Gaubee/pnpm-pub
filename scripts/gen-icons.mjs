/**
 * Tray-icon rasterizer (Chapter 1.3.2).
 *
 * opentray's native icon format is `rgba` PNG (`@opentray/spec` `Icon` type),
 * so the SVG source-of-truth marks under assets/ must be rasterized to real
 * PNG files before the daemon can use them as tray icons. This script is the
 * ONLY place that produces those PNGs — they are build artifacts and are
 * git-ignored (see .gitignore), so never hand-edit a tray *.png.
 *
 * Source SVGs (single source of truth):
 *   assets/icon.svg            red npm square  (#c12127) — Windows tray + favicon + sidebar
 *   assets/icon-mono.svg       black silhouette, transparent bg — macOS template tray
 *   assets/icon-pending.svg    red square + blue pending badge dot — Windows pending
 *   assets/icon-mono-pending.svg black silhouette + badge dot — macOS pending
 *
 * Outputs (64×64 rgba PNG, the size opentray expects for crisp menubar/dpi rendering):
 *   assets/icon-windows.png / icon-windows-pending.png
 *   assets/icon-macos.png   / icon-macos-pending.png
 *
 * Run via `pnpm gen:icons`; wired into build/dev so the PNGs always exist.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(__dirname, '..', 'assets');

const SIZE = 64;

/** SVG source → output PNG file name. */
const targets = [
  { svg: 'icon.svg', png: 'icon-windows.png' },
  { svg: 'icon-pending.svg', png: 'icon-windows-pending.png' },
  { svg: 'icon-mono.svg', png: 'icon-macos.png' },
  { svg: 'icon-mono-pending.svg', png: 'icon-macos-pending.png' },
];

async function rasterize({ svg, png }) {
  const svgBuffer = await readFile(join(assetsDir, svg));
  // fitTo width/height keeps the square 1:1; background stays transparent so
  // the macOS template silhouette and its badge alpha render correctly.
  const resvg = new Resvg(svgBuffer, {
    fitTo: { mode: 'width', value: SIZE },
    background: 'rgba(0,0,0,0)',
  });
  const pngBuffer = resvg.render().asPng();
  await writeFile(join(assetsDir, png), pngBuffer);
}

await mkdir(assetsDir, { recursive: true });
for (const target of targets) {
  await rasterize(target);
  // eslint-disable-next-line no-console
  console.log(`[gen:icons] ${target.svg} → ${target.png} (${SIZE}×${SIZE})`);
}
