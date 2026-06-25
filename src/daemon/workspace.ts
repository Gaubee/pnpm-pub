/**
 * Local Workspace Engine (Chapter 5.3).
 *
 * Responsibilities:
 *  - Find the project root from an arbitrary CWD (5.3.1)
 *  - Risk-boundary defense against huge non-project dirs (5.3.2)
 *  - High-speed directory scanner, pnpm-workspace.yaml first (5.3.4 / 6.3.1)
 *  - Profile-scope filtering by `@scope/name` (5.3.5)
 *
 * Pure-logic functions are exported so the vitest suite (Chapter 10.1) can run
 * them against an in-memory `memfs` volume.
 */
import path from 'node:path';
import type { fs as FsAPI } from './fs-types.js';

/** Markers that identify a project root, in priority order (Chapter 5.3.1). */
const ROOT_MARKERS = ['pnpm-workspace.yaml', '.git', 'package.json'] as const;

export interface FindRootResult {
  /** Resolved absolute root path, or null when no marker is found (risk case). */
  root: string | null;
  /** Which marker identified the root (debug info). */
  matchedMarker?: string;
}

/**
 * Walk upward from `cwd` looking for a project root. Markers are evaluated by
 * PRIORITY, not proximity: the closest `pnpm-workspace.yaml` wins over a
 * nearer `package.json` (Chapter 5.3.1 — priority: pnpm-workspace.yaml -> .git
 * -> package.json).
 *
 * Strategy: collect the nearest ancestor of each marker type, then pick by the
 * priority order above.
 */
export async function findProjectRoot(cwd: string, fs: FsAPI): Promise<FindRootResult> {
  const start = path.resolve(cwd);
  const found = new Map<string, string>(); // marker -> nearest ancestor dir

  // Walk all the way up, recording the FIRST (nearest) dir per marker.
  let dir = start;
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (found.has(marker)) continue;
      if (await fs.exists(fs.join(dir, marker))) {
        found.set(marker, dir);
      }
    }
    const parent = fs.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Pick the highest-priority marker that was found.
  for (const marker of ROOT_MARKERS) {
    if (found.has(marker)) {
      return { root: found.get(marker)!, matchedMarker: marker };
    }
  }
  // No marker at all — risk case (Chapter 5.3.2).
  return { root: null };
}

/**
 * Risk-boundary check. Returns true if `dir` looks like a non-project path that
 * a user might accidentally add (Downloads, home, system root) — Chapter 5.3.2.
 */
export function isRiskyRoot(dir: string, fs: FsAPI): boolean {
  const resolved = path.resolve(dir);
  // The literal filesystem root.
  if (resolved === fs.dirname(resolved)) return true;
  // The user home directory itself is almost always too broad.
  if (resolved === fs.home()) return true;
  const base = path.basename(resolved).toLowerCase();
  const risky = ['downloads', 'desktop', 'documents', 'tmp', 'temp', 'library', 'applications'];
  return risky.includes(base);
}

// ---------------------------------------------------------------------------
// Scanner (5.3.4 / 6.3.1)
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  'coverage',
]);

export interface ScannedPackage {
  name: string;
  version: string;
  description?: string;
  private?: boolean;
  /** Absolute path to the package directory. */
  path: string;
}

export interface ScanOptions {
  /** Project root containing (optionally) pnpm-workspace.yaml. */
  root: string;
  /** Honor a `.gitignore` at root to skip ignored paths. */
  respectGitignore?: boolean;
}

/**
 * Parse the `packages:` glob list from a pnpm-workspace.yaml, if present.
 * Returns null when the file does not exist or is unparseable.
 *
 * This is a deliberately tiny YAML reader — we only need a top-level
 * `packages:` list of glob strings, so we avoid a full yaml dependency.
 */
export async function readWorkspacePackages(root: string, fs: FsAPI): Promise<string[] | null> {
  const file = fs.join(root, 'pnpm-workspace.yaml');
  if (!(await fs.exists(file))) return null;
  const text = await fs.readFile(file);
  const lines = text.split(/\r?\n/);
  const globs: string[] = [];
  let inPackages = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!inPackages) {
      if (/^packages\s*:/.test(line)) inPackages = true;
      continue;
    }
    // A list item under `packages:`.
    const m = line.match(/^\s+-\s+['"]?([^'"]+?)['"]?\s*$/);
    if (m) {
      globs.push(m[1]!);
      continue;
    }
    // If we hit a new top-level key, the packages list is over.
    if (/^[^\s#-]/.test(line)) break;
  }
  return globs.length > 0 ? globs : [];
}

/** Convert a pnpm-workspace glob (e.g. `packages/*`) into a directory-glob. */
function workspaceGlobToDirPrefix(glob: string): { base: string; tail: string } | null {
  // Handle simple forms: `packages/*`, `apps/*`, `tools/*`.
  // We only support the common single-level `dir/*` shape; anything richer
  // falls back to recursive scanning.
  const m = glob.match(/^([^*]+)\*+$/);
  if (!m) return null;
  return { base: m[1]!.replace(/\/$/, ''), tail: '*' };
}

/** Minimal glob -> RegExp for `*` (single segment) and `**` (any depth). */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{GLOBSTAR}}/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Read & parse a package.json; returns null if invalid / unreadable. */
async function readPackageJson(
  file: string,
  fs: FsAPI,
): Promise<ScannedPackage | null> {
  try {
    const text = await fs.readFile(file);
    const pkg = JSON.parse(text) as Record<string, unknown>;
    if (typeof pkg.name !== 'string') return null;
    return {
      name: pkg.name,
      version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
      description: typeof pkg.description === 'string' ? pkg.description : undefined,
      private: pkg.private === true,
      path: fs.dirname(file),
    };
  } catch {
    return null;
  }
}

/**
 * Recursive scan honoring the exclude set. Bounded by `maxDepth`.
 *
 * @param onPackage invoked for every package.json encountered.
 */
async function scanRecursive(
  dir: string,
  fs: FsAPI,
  onPackage: (pkg: ScannedPackage) => void,
  opts: { maxDepth: number; depth: number; gitignore: Set<string> },
): Promise<void> {
  if (opts.depth > opts.maxDepth) return;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = fs.join(dir, entry);
    if (opts.gitignore.has(full)) continue;
    const isDir = await fs.isDirectory(full);
    if (isDir) {
      await scanRecursive(full, fs, onPackage, {
        maxDepth: opts.maxDepth,
        depth: opts.depth + 1,
        gitignore: opts.gitignore,
      });
    } else if (entry === 'package.json') {
      const pkg = await readPackageJson(full, fs);
      if (pkg) onPackage(pkg);
    }
  }
}

/** Parse a .gitignore at root into a set of ignored absolute paths (best-effort). */
async function readGitignoreSet(root: string, fs: FsAPI): Promise<Set<string>> {
  const file = fs.join(root, '.gitignore');
  const set = new Set<string>();
  if (!(await fs.exists(file))) return set;
  const text = await fs.readFile(file);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Only handle the simple directory form (e.g. `coverage/`, `build`).
    const cleaned = line.replace(/\/+$/, '');
    set.add(fs.join(root, cleaned));
  }
  return set;
}

/**
 * High-speed scanner. pnpm-workspace.yaml globs are honored first; if absent or
 * unparseable we fall back to a bounded heuristic recursive walk (Chapter 5.3.4
 * / 6.3.1).
 */
export async function scanWorkspace(root: string, fs: FsAPI, opts: ScanOptions = { root }): Promise<ScannedPackage[]> {
  const results: ScannedPackage[] = [];
  const seen = new Set<string>();
  const add = (pkg: ScannedPackage): void => {
    if (seen.has(pkg.path)) return;
    // Chapter 5.3.4: packages marked "private": true are ignored outright.
    if (pkg.private) return;
    seen.add(pkg.path);
    results.push(pkg);
  };

  const gitignore = opts.respectGitignore ? await readGitignoreSet(root, fs) : new Set<string>();

  // 1. pnpm-workspace.yaml-driven scan (priority).
  const globs = await readWorkspacePackages(root, fs);
  if (globs && globs.length > 0) {
    for (const glob of globs) {
      const simple = workspaceGlobToDirPrefix(glob);
      if (simple) {
        const baseDir = fs.join(root, simple.base);
        if (!(await fs.isDirectory(baseDir))) continue;
        let entries: string[];
        try {
          entries = await fs.readdir(baseDir);
        } catch {
          continue;
        }
        for (const entry of entries) {
          const full = fs.join(baseDir, entry);
          if (!(await fs.isDirectory(full))) continue;
          if (EXCLUDE_DIRS.has(entry)) continue;
          const pkgJson = fs.join(full, 'package.json');
          if (await fs.exists(pkgJson)) {
            const pkg = await readPackageJson(pkgJson, fs);
            if (pkg) add(pkg);
            continue;
          }
          // Scoped layout: packages/@scope/name — descend one level when the
          // entry is a scope dir (starts with '@') with no package.json.
          if (entry.startsWith('@')) {
            let scoped: string[];
            try {
              scoped = await fs.readdir(full);
            } catch {
              continue;
            }
            for (const sub of scoped) {
              if (EXCLUDE_DIRS.has(sub)) continue;
              const subFull = fs.join(full, sub);
              if (!(await fs.isDirectory(subFull))) continue;
              const subPkgJson = fs.join(subFull, 'package.json');
              if (await fs.exists(subPkgJson)) {
                const pkg = await readPackageJson(subPkgJson, fs);
                if (pkg) add(pkg);
              }
            }
          }
        }
      } else {
        // Richer glob — fall back to recursive scan filtered by the pattern.
        const re = globToRegExp(glob);
        const collected: ScannedPackage[] = [];
        await scanRecursive(root, fs, (p) => collected.push(p), {
          maxDepth: 6,
          depth: 0,
          gitignore,
        });
        for (const pkg of collected) {
          const rel = pkg.path.slice(root.length).replace(/^[\\/]/, '');
          if (re.test(rel)) add(pkg);
        }
      }
    }
  }

  // 2. Always include the root package.json itself.
  const rootPkg = await readPackageJson(fs.join(root, 'package.json'), fs);
  if (rootPkg) add(rootPkg);

  // 3. Heuristic fallback: when there is no pnpm-workspace.yaml, walk the tree
  //    to discover nested packages (the root pkg may already be in `results`,
  //    but its sub-packages still need to be collected).
  if (!globs || globs.length === 0) {
    await scanRecursive(root, fs, add, { maxDepth: 6, depth: 0, gitignore });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Profile filtering (5.3.5)
// ---------------------------------------------------------------------------

/**
 * Filter scanned packages by the active profile's scope.
 *
 * Matching rules (Chapter 5.3.5):
 *  - Drop `"private": true` packages always.
 *  - A scoped package `@<scope>/...` belongs to a profile whose username (or a
 *    configured alias) equals that scope.
 *  - Unscoped packages belong to everyone (they are returned).
 */
export function filterByProfile(
  packages: ScannedPackage[],
  username: string,
): ScannedPackage[] {
  const scope = username.toLowerCase();
  const out: ScannedPackage[] = [];
  for (const pkg of packages) {
    if (pkg.private) continue;
    const m = pkg.name.match(/^@([^/]+)\//);
    if (!m) {
      out.push(pkg); // unscoped — show it
      continue;
    }
    if (m[1]!.toLowerCase() === scope) out.push(pkg);
  }
  return out;
}
