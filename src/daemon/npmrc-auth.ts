/** External npm userconfig construction for native `pnpm publish`. */
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const noProto = registry.replace(/^[a-z]+:\/\//i, "");
  const noTrailing = noProto.replace(/\/+$/, "");
  return `//${noTrailing}/`;
}

/**
 * Replace the default registry and the selected registry's auth token while
 * preserving inherited settings and credentials for unrelated registries.
 *
 * The auth line uses the canonical npm form `<prefix>:_authToken=<token>` —
 * the colon after the trailing slash is REQUIRED; without it npm/pnpm treat the
 * line as an unknown config option and silently drop it.
 *
 * Blank lines are dropped so the generated overlay stays compact.
 */
export function mergeAuthIntoNpmrc(
  content: string,
  registry: string,
  prefix: string,
  token: string,
): string {
  const authKey = `${prefix}:_authToken`;
  const preserved = content.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || REGISTRY_LINE_RE.test(line)) return false;
    const separator = trimmed.indexOf("=");
    return separator < 0 || trimmed.slice(0, separator).trim() !== authKey;
  });
  const registryLine = `registry=${registry}`;
  const authLine = `${authKey}=${token}`;
  const managed = `${registryLine}\n${authLine}\n`;
  return preserved.length > 0 ? `${preserved.join("\n")}\n${managed}` : managed;
}

/** Registry-scoped npm config environment key used by pnpm 10+. */
export function registryAuthEnvKey(registry: string): string {
  return `npm_config_${registryAuthPrefix(registry)}:_authToken`;
}

/** Resolve the userconfig pnpm would inherit before pnpm-pub installs its overlay. */
export function resolveInheritedUserconfigPath(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.npm_config_userconfig ?? env.NPM_CONFIG_USERCONFIG;
  return configured && configured.length > 0
    ? path.resolve(cwd, configured)
    : path.join(os.homedir(), ".npmrc");
}

async function readInheritedUserconfig(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === "ENOENT") return "";
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Extend the inherited npm userconfig in a daemon-owned temporary directory.
 * The project worktree is never mutated. Registry/auth environment overrides
 * keep the selected profile authoritative over a conflicting project `.npmrc`.
 */
export async function withTempUserconfig<T>(
  cwd: string,
  registry: string,
  token: string,
  fn: (env: NodeJS.ProcessEnv) => Promise<T>,
  sourceEnv: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const inheritedFile = resolveInheritedUserconfigPath(cwd, sourceEnv);
  const inherited = await readInheritedUserconfig(inheritedFile);
  const prefix = registryAuthPrefix(registry);
  const content = mergeAuthIntoNpmrc(inherited, registry, prefix, token);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-pub-userconfig-"));
  const userconfig = path.join(tempDir, "npmrc");
  try {
    await fsp.writeFile(userconfig, content, { mode: 0o600 });
    return await fn({
      NPM_CONFIG_USERCONFIG: userconfig,
      NPM_CONFIG_REGISTRY: registry,
      [registryAuthEnvKey(registry)]: token,
    });
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}
