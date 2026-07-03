/**
 * Temporary project `.npmrc` auth injection.
 *
 * `pnpm publish` (like npm) reads credentials from a project-level `.npmrc` in
 * `cwd`. pnpm 10 does NOT honor the `npm_config_//host/:_authToken` env-var form
 * (that arrived in 11.6) and does NOT expand `${ENV}` in a project `.npmrc`
 * (security), so the only reliable, zero-pollution injection across all
 * supported pnpm versions is a *temporary* project `.npmrc` written by the
 * daemon: registry + auth lines are written into the package directory's
 * `.npmrc` for the duration of the subprocess and restored (or removed) in a
 * `finally`, mirroring how `packer.ts` writes its `.tgz` to a daemon-owned
 * scratch dir.
 *
 * All functions here are pure / side-effect-bounded so they can be unit-tested
 * without spawning pnpm.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const NPMRC_FILENAME = '.npmrc';

/** Lines we strip+replace when injecting our own authoritative values.
 *  Matches the canonical `//<host>[:<path>]/:_authToken=` form (colon required
 *  between the registry path and the `_authToken` key — this is what npm/pnpm
 *  actually parse; without the colon the line is rejected as unknown config). */
const AUTH_LINE_RE = /^\s*\/\/[^/].*\/:_authToken\s*=/;
const REGISTRY_LINE_RE = /^\s*registry\s*=/;

/**
 * Parse a registry URL into the npm registry path prefix `//<host-and-path>/`.
 * e.g. "https://registry.npmjs.org/" -> "//registry.npmjs.org/"
 *
 * NOTE: this is the registry *path* only. The full auth key requires a colon
 * separator: `<prefix>:_authToken` (see {@link mergeAuthIntoNpmrc}). Emitting
 * `<prefix>_authToken` (no colon) is silently ignored by npm/pnpm, so the token
 * never reaches the registry — every publish then fails auth.
 */
export function registryAuthPrefix(registry: string): string {
  const noProto = registry.replace(/^[a-z]+:\/\//i, '');
  const noTrailing = noProto.replace(/\/+$/, '');
  return `//${noTrailing}/`;
}

/**
 * Remove any pre-existing `//.../:_authToken=` and `registry=` lines from the
 * user's `.npmrc`, then append the injected registry + auth lines. We own both
 * so the subprocess targets exactly the resolved registry with a matching
 * credential (and the user's own registry/auth lines, if any, don't shadow it).
 *
 * The auth line uses the canonical npm form `<prefix>:_authToken=<token>` —
 * the colon after the trailing slash is REQUIRED; without it npm/pnpm treat the
 * line as an unknown config option and silently drop it.
 *
 * Blank lines are dropped so the result stays tidy regardless of input shape.
 */
export function mergeAuthIntoNpmrc(content: string, registry: string, prefix: string, token: string): string {
  const preserved = content
    .split('\n')
    .filter((line) => line.trim().length > 0 && !AUTH_LINE_RE.test(line) && !REGISTRY_LINE_RE.test(line));
  const registryLine = `registry=${registry}`;
  const authLine = `${prefix}:_authToken=${token}`;
  const managed = `${registryLine}\n${authLine}\n`;
  return preserved.length > 0 ? `${preserved.join('\n')}\n${managed}` : managed;
}

/** Existing `.npmrc` state captured for restore (or `null` if none existed). */
interface NpmrcSnapshot {
  /** Absolute path to the `.npmrc`. */
  file: string;
  /** Original bytes (`null` = file did not exist). */
  original: Buffer | null;
}

async function captureSnapshot(cwd: string): Promise<NpmrcSnapshot> {
  const file = path.join(cwd, NPMRC_FILENAME);
  try {
    const original = await fsp.readFile(file);
    return { file, original };
  } catch {
    return { file, original: null };
  }
}

async function restoreSnapshot(snapshot: NpmrcSnapshot): Promise<void> {
  if (snapshot.original === null) {
    await fsp.rm(snapshot.file, { force: true });
  } else {
    await fsp.writeFile(snapshot.file, snapshot.original, { mode: 0o600 });
  }
}

/**
 * Install the auth token + registry into the package directory's `.npmrc` and
 * run `fn`; restore the original `.npmrc` (or remove it) afterwards, even on
 * throw.
 *
 * The token is written with mode 0600 for the brief window it exists on disk,
 * matching the daemon-managed temp-file security model of `packer.ts`.
 *
 * Returns the snapshot for diagnostic/restore-test purposes.
 */
export async function withTempNpmrc<T>(
  cwd: string,
  registry: string,
  token: string,
  fn: () => Promise<T>,
): Promise<T> {
  const snapshot = await captureSnapshot(cwd);
  const prefix = registryAuthPrefix(registry);
  const previous = snapshot.original?.toString('utf8') ?? '';
  const next = mergeAuthIntoNpmrc(previous, registry, prefix, token);
  await fsp.writeFile(snapshot.file, next, { mode: 0o600 });
  try {
    return await fn();
  } finally {
    try {
      await restoreSnapshot(snapshot);
    } catch {
      // best-effort restore; a leftover .npmrc would only matter if the user
      // had none and it now contains the token. The publish result has already
      // been captured; a restore failure is strictly rarer than the write that
      // just succeeded on the same file.
    }
  }
}
