/**
 * Keychain adapter (Chapter 3.1, 4.2, 9.2).
 *
 * Uses `@github/keytar` for OS-level credential storage (macOS Keychain,
 * Windows Credential Manager). Per Chapter 9.2 the native `.node` binary is
 * copied into `dist/prebuilds/keytar/<plat>-<arch>.node` at build time and
 * dynamically required here — never statically imported — so tsdown can inline
 * the JS surface while leaving the binary out of the bundle.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_SANDBOX, tokenKey, totpKey } from '../shared/index.js';

// ESM-safe __dirname (tsdown shims __dirname in the bundle, but dev/tsx and
// vitest run true ESM where it is undefined).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chapter 9.2.3: a single `require` bound to this module, used to mount the
// native keytar binary at runtime. keytar is NEVER statically imported.
const require = createRequire(import.meta.url);

/**
 * Test seam: an injected keytar surface. When set, `loadKeytar` returns this
 * instead of resolving the native binary — this lets the sandbox tests (Chapter
 * 10.2.1) drive an in-memory keytar without depending on the host's module
 * resolution (createRequire bypasses vi.mock's import hook).
 */
export function __setKeytarForTest(api: KeytarApi | null): void {
  cached = api;
}

/** Shape of the @github/keytar native surface we actually use. */
interface KeytarApi {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
  findPassword(service: string): Promise<string | null>;
}

let cached: KeytarApi | null = null;
let serviceOverride: string | null = null;

/** Override the service name — used by the test sandbox (Chapter 10.2). */
export function useSandboxService(): void {
  serviceOverride = KEYCHAIN_SERVICE_SANDBOX;
}

/** Reset the service override (cleanup in tests). */
export function resetService(): void {
  serviceOverride = null;
  cached = null;
}

/** The active service name. */
export function activeService(): string {
  return serviceOverride ?? KEYCHAIN_SERVICE;
}

/**
 * Resolve the path to the platform's prebuilt binary. The location mirrors the
 * `tsdown` copy-plugin output (Chapter 9.2.2): `dist/prebuilds/keytar/...`.
 */
function resolveBinaryPath(): string {
  // __dirname points at dist/ (bundled) or src/daemon/ (dev). Both resolve to a
  // `prebuilds/keytar` somewhere nearby; return the first that exists.
  const candidates = [
    path.join(__dirname, '..', 'prebuilds', 'keytar', `${process.platform}-${process.arch}.node`),
    path.join(__dirname, '..', '..', 'prebuilds', 'keytar', `${process.platform}-${process.arch}.node`),
    path.join(process.cwd(), 'prebuilds', 'keytar', `${process.platform}-${process.arch}.node`),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0]!;
}

/**
 * Dynamically mount the native keytar binding (Chapter 9.2.3).
 *
 * The spec's hard rule is: keytar must be loaded via `require(keytarPath)`,
 * never via a static `import`. We honour that literally:
 *   1. If a prebuilt `.node` exists at the copied fat-package path, require it.
 *   2. Otherwise (dev / not bundled) require the installed `@github/keytar`
 *      package through the same `createRequire` conduit — still a runtime
 *      require, never a static import that tsdown could inline.
 */
export async function loadKeytar(): Promise<KeytarApi> {
  if (cached) return cached;
  // 1. Bundled layout (Chapter 9.2.2): the inlined keytar JS shim sits next to
  //    the copied prebuilds. Require it — it loads the platform .node binary.
  const inlineJs = path.join(__dirname, 'prebuilds', 'keytar', 'keytar.js');
  if (fs.existsSync(inlineJs)) {
    const mod = require(inlineJs) as { default?: KeytarApi } & KeytarApi;
    cached = (mod.default ?? mod) as KeytarApi;
    return cached;
  }
  // 2. Direct native binary (legacy / explicit).
  const binaryPath = resolveBinaryPath();
  if (fs.existsSync(binaryPath)) {
    cached = require(binaryPath) as KeytarApi;
    return cached;
  }
  // 3. Dev fallback: resolve the package through createRequire so it is never a
  //    static import (keeps keytar out of the bundle graph in production builds).
  const resolved = require.resolve('@github/keytar');
  const mod = require(resolved) as { default?: KeytarApi } & KeytarApi;
  cached = (mod.default ?? mod) as KeytarApi;
  return cached;
}

// ---------------------------------------------------------------------------
// High-level helpers mapped to Chapter 4.2's account-key convention.
// ---------------------------------------------------------------------------

export async function setToken(username: string, token: string): Promise<void> {
  const k = await loadKeytar();
  await k.setPassword(activeService(), tokenKey(username), token);
}

export async function getToken(username: string): Promise<string | null> {
  const k = await loadKeytar();
  return k.getPassword(activeService(), tokenKey(username));
}

export async function setTotpSecret(username: string, secret: string): Promise<void> {
  const k = await loadKeytar();
  await k.setPassword(activeService(), totpKey(username), secret);
}

export async function getTotpSecret(username: string): Promise<string | null> {
  const k = await loadKeytar();
  return k.getPassword(activeService(), totpKey(username));
}

export async function deleteProfile(username: string): Promise<void> {
  const k = await loadKeytar();
  await k.deletePassword(activeService(), tokenKey(username));
  await k.deletePassword(activeService(), totpKey(username));
}

export async function listStoredAccounts(): Promise<string[]> {
  const k = await loadKeytar();
  const creds = await k.findCredentials(activeService());
  const set = new Set<string>();
  for (const c of creds) {
    // account keys look like `${username}_npm_token` / `${username}_totp_secret`
    const idx = c.account.lastIndexOf('_');
    if (idx > 0) set.add(c.account.slice(0, idx));
  }
  return [...set];
}
