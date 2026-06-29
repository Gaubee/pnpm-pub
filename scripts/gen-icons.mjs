/**
 * Tray-icon rasterizer (Chapter 1.3.2).
 *
 * opentray's native icon format is `rgba` PNG (`@opentray/spec` `Icon` type),
 * so the SVG source-of-truth marks under assets/ must be rasterized to real
 * PNG files before the daemon can use them as tray icons. This module is the
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
 *   <outDir>/icon-windows.png / icon-windows-pending.png
 *   <outDir>/icon-macos.png   / icon-macos-pending.png
 *
 * Two entry modes:
 *   - `node scripts/gen-icons.mjs`              → writes into assets/ (legacy, build step)
 *   - `import { generateIcons } from '...'`     → writes into a caller-chosen outDir
 *     (used by the vite dev plugin's content-hash cache)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_ASSETS_DIR = join(ROOT, 'assets');

const SIZE = 64;

/** SVG source → output PNG file name. */
export const ICON_TARGETS = [
	{ svg: 'icon.svg', png: 'icon-windows.png' },
	{ svg: 'icon-pending.svg', png: 'icon-windows-pending.png' },
	{ svg: 'icon-mono.svg', png: 'icon-macos.png' },
	{ svg: 'icon-mono-pending.svg', png: 'icon-macos-pending.png' },
];

/**
 * The list of source files whose content determines whether the rasterized
 * cache is still valid: the four SVGs plus this script itself (so edits to the
 * rasterization logic also invalidate the cache). Resolved relative to ROOT.
 */
export const ICON_HASH_SOURCES = [
	...ICON_TARGETS.map((t) => join('assets', t.svg)),
	join('scripts', 'gen-icons.mjs'),
];

/**
 * Compute a stable content hash over the icon SVG sources + this script.
 * Two runs with identical inputs yield identical hashes, so a content-addressed
 * cache directory (`<cacheRoot>/<hash>/`) can be reused across dev sessions.
 *
 * Returns the short hash (first 16 hex chars) — enough collision resistance for
 * local dev caches, and keeps the path short for the macOS socket limit.
 */
export async function computeIconHash(root = ROOT) {
	const hash = createHash('sha256');
	for (const rel of ICON_HASH_SOURCES) {
		const abs = join(root, rel);
		const buf = await readFile(abs);
		hash.update(rel);
		hash.update('\0');
		hash.update(buf);
	}
	return hash.digest('hex').slice(0, 16);
}

/**
 * Rasterize the SVG sources into PNGs in `outDir`.
 *
 * @param {{ outDir: string, assetsDir?: string, size?: number }} opts
 *   - outDir:     where to write the PNGs (created if missing)
 *   - assetsDir:  where the SVG sources live (default <root>/assets)
 *   - size:       target width/height in px (default 64)
 * @returns {Promise<string[]>} absolute paths of the written PNGs
 */
export async function generateIcons({ outDir, assetsDir = DEFAULT_ASSETS_DIR, size = SIZE }) {
	await mkdir(outDir, { recursive: true });
	const written = [];
	for (const target of ICON_TARGETS) {
		const svgBuffer = await readFile(join(assetsDir, target.svg));
		// fitTo width/height keeps the square 1:1; background stays transparent so
		// the macOS template silhouette and its badge alpha render correctly.
		const resvg = new Resvg(svgBuffer, {
			fitTo: { mode: 'width', value: size },
			background: 'rgba(0,0,0,0)',
		});
		const pngBuffer = resvg.render().asPng();
		const outPath = join(outDir, target.png);
		await writeFile(outPath, pngBuffer);
		written.push(resolve(outPath));
	}
	return written;
}

/**
 * Resolve the icon cache directory for the current sources, rasterizing on
 * cache miss. Returns the directory holding the PNGs.
 *
 *   ensureIcons({ cacheRoot: <root>/node_modules/.cache/pnpm-pub-icons })
 *     → first run:  generates into .../pnpm-pub-icons/<hash>/, returns it
 *     → same inputs: sees <hash>/ already populated, skips generation
 *
 * @param {{ cacheRoot: string, root?: string, force?: boolean }} opts
 */
export async function ensureIcons({ cacheRoot, root = ROOT, force = false }) {
	const hash = await computeIconHash(root);
	const outDir = join(cacheRoot, hash);
	const expected = ICON_TARGETS.map((t) => join(outDir, t.png));
	// Cache hit only when every expected PNG already exists.
	const { access } = await import('node:fs/promises');
	const cached = !force && (await Promise.all(expected.map((p) => access(p).then(() => true, () => false)))).every(Boolean);
	if (!cached) {
		await generateIcons({ outDir, assetsDir: join(root, 'assets') });
	}
	return { dir: outDir, hash, generated: !cached };
}

// Legacy direct-run mode: `pnpm gen:icons` writes into assets/.
// Keeps the standalone build step working without the vite plugin.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
	const written = await generateIcons({ outDir: DEFAULT_ASSETS_DIR });
	for (const p of written) {
		// eslint-disable-next-line no-console
		console.log(`[gen:icons] → ${basename(p)} (${SIZE}×${SIZE})`);
	}
}
