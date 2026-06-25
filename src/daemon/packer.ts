/**
 * Tarball packer — builds the publishable `.tgz` for a package directory.
 *
 * Prefers `pnpm pack` (this tool's namesake) and falls back to `npm pack`,
 * matching the spec's promise of 1:1 compatibility with `pnpm publish`
 * (Chapter 1.3.1 / 7.1.2). The produced tarball is returned as bytes so the
 * NPM API layer can attach it to the publish request.
 *
 * `pack` is deterministic about its output filename (`<name>-<version>.tgz`),
 * but we glob the cwd for the newest `.tgz` after packing to be robust against
 * scoped-name mangling and `pack-destination` overrides.
 */
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

export interface PackResult {
  /** Raw tarball bytes. */
  tarball: Buffer;
  /** Absolute path of the produced .tgz on disk. */
  tarballPath: string;
  /** The package.json metadata that was packed. */
  metadata: Record<string, unknown>;
}

/** Run a command, capturing stdout/stderr as strings. */
function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (c) => stdoutChunks.push(c as Buffer));
    child.stderr.on('data', (c) => stderrChunks.push(c as Buffer));
    child.on('error', () => resolve({ code: 1, stdout: '', stderr: 'spawn failed' }));
    child.on('close', (code) =>
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      }),
    );
  });
}

/** Whether a given binary is resolvable on PATH. */
async function has(cmd: string): Promise<boolean> {
  const probe = await run(cmd, ['--version'], process.cwd());
  return probe.code === 0;
}

/** Locate the newest `.tgz` in `dir` after packing. */
async function newestTgz(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  let newest: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.tgz')) continue;
    const full = path.join(dir, entry);
    try {
      const st = await fsp.stat(full);
      if (!newest || st.mtimeMs > newest.mtime) newest = { path: full, mtime: st.mtimeMs };
    } catch {
      /* ignore */
    }
  }
  return newest?.path ?? null;
}

/**
 * Pack `cwd` into a tarball. Prefers `pnpm pack`, falls back to `npm pack`.
 * Removes any pre-existing `.tgz` first so we don't pick up a stale artifact.
 */
export async function packPackage(cwd: string): Promise<PackResult> {
  // Read metadata BEFORE packing so we can name/validate the result.
  const pkgJsonPath = path.join(cwd, 'package.json');
  const metadata = JSON.parse(await fsp.readFile(pkgJsonPath, 'utf8')) as Record<string, unknown>;

  // Clean stale tarballs so newestTgz() reliably finds this run's output.
  try {
    for (const entry of await fsp.readdir(cwd)) {
      if (entry.endsWith('.tgz')) await fsp.unlink(path.join(cwd, entry));
    }
  } catch {
    /* best effort */
  }

  let res: { code: number; stdout: string; stderr: string };
  if (await has('pnpm')) {
    res = await run('pnpm', ['pack'], cwd);
  } else if (await has('npm')) {
    res = await run('npm', ['pack'], cwd);
  } else {
    throw new Error('Neither pnpm nor npm is available on PATH; cannot pack.');
  }
  if (res.code !== 0) {
    throw new Error(`pack failed (exit ${res.code}): ${res.stderr || res.stdout}`);
  }

  const tarballPath = await newestTgz(cwd);
  if (!tarballPath) {
    throw new Error('pack succeeded but no .tgz was produced');
  }
  const tarball = await fsp.readFile(tarballPath);

  return { tarball, tarballPath, metadata };
}
