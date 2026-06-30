/**
 * Keychain adapter (Chapter 3.1, 4.2, 9.2).
 *
 * Uses `@github/keytar` for OS-level credential storage (macOS Keychain,
 * Windows Credential Manager). Per Chapter 9.2 the native `.node` binary is
 * copied into `dist/prebuilds/keytar/` at build time and dynamically required
 * here — never statically imported — so tsdown can inline the JS surface while
 * leaving the binary out of the bundle graph.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_SANDBOX, tokenKey, totpKey, authKey } from '../shared/index.js';
import { ProfileSecretsSchema } from '../shared/schemas.js';

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
 * Dynamically mount the native keytar binding (Chapter 9.2.3).
 *
 * The spec's hard rule is: keytar must be loaded at runtime via `require`,
 * never via a static `import`. We honour that literally:
 *   1. If the copied fat-package keytar JS shim exists, require it.
 *   2. Otherwise (dev / not bundled) require the installed `@github/keytar`
 *      package through the same `createRequire` conduit — still a runtime
 *      require, never a static import that tsdown could inline.
 */
export async function loadKeytar(): Promise<KeytarApi> {
  if (cached) return cached;
  // 1. Bundled layout (Chapter 9.2.2): the copied keytar JS shim sits next to
  //    its copied prebuilds. Require it — it loads the platform .node binary.
  const inlineJs = path.join(__dirname, 'prebuilds', 'keytar', 'lib', 'keytar.js');
  if (fs.existsSync(inlineJs)) {
    const mod: unknown = require(inlineJs);
    cached = parseKeytarModule(mod);
    return cached;
  }
  // 2. Dev fallback: resolve the package through createRequire so it is never a
  //    static import (keeps keytar out of the bundle graph in production builds).
  const resolved = require.resolve('@github/keytar');
  const mod: unknown = require(resolved);
  cached = parseKeytarModule(mod);
  return cached;
}

function parseKeytarModule(value: unknown): KeytarApi {
  if (isKeytarApi(value)) return value;
  if (isRecord(value) && isKeytarApi(value.default)) return value.default;
  throw new Error('Loaded @github/keytar module does not expose the required credential API.');
}

function isKeytarApi(value: unknown): value is KeytarApi {
  return (
    isRecord(value) &&
    typeof value.setPassword === 'function' &&
    typeof value.getPassword === 'function' &&
    typeof value.deletePassword === 'function' &&
    typeof value.findCredentials === 'function' &&
    typeof value.findPassword === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// High-level helpers mapped to Chapter 4.2's account-key convention.
// ---------------------------------------------------------------------------

export async function setToken(username: string, token: string): Promise<void> {
  const k = await loadKeytar();
  await k.setPassword(activeService(), tokenKey(username), token);
}

export async function deleteToken(username: string): Promise<void> {
  const k = await loadKeytar();
  await k.deletePassword(activeService(), tokenKey(username));
}

export async function getToken(username: string): Promise<string | null> {
  const k = await loadKeytar();
  return k.getPassword(activeService(), tokenKey(username));
}

export async function setTotpSecret(username: string, secret: string): Promise<void> {
  const k = await loadKeytar();
  await k.setPassword(activeService(), totpKey(username), secret);
}

export async function deleteTotpSecret(username: string): Promise<void> {
  const k = await loadKeytar();
  await k.deletePassword(activeService(), totpKey(username));
}

export async function getTotpSecret(username: string): Promise<string | null> {
  const k = await loadKeytar();
  return k.getPassword(activeService(), totpKey(username));
}

export async function deleteProfile(username: string): Promise<void> {
  // Best-effort: clear the merged auth item AND the legacy split items so no
  // stale secret survives a profile removal regardless of which format wrote it.
  await deleteProfileSecrets(username).catch(() => {});
  await deleteToken(username);
  await deleteTotpSecret(username);
}

// ---------------------------------------------------------------------------
// Merged profile-auth item (Chapter 4.2) — stores ALL of a profile's secrets
// (token + totp + npm password) as ONE JSON string under `authKey(username)`.
// One keychain read (one OS auth prompt) yields everything, vs. the legacy
// split format which required a prompt per field.
// ---------------------------------------------------------------------------

/** Every persisted secret for one profile, stored together in the keychain. */
export interface ProfileSecrets {
  npm_token: string;
  totp_secret: string;
  /** Stored so an expired token can be silently re-minted without re-entering. */
  npm_pwd: string;
}

function isProfileSecrets(value: unknown): value is ProfileSecrets {
  return ProfileSecretsSchema.safeParse(value).success;
}

/** Read the merged profile-auth item; null when absent or malformed. */
export async function getProfileSecrets(username: string): Promise<ProfileSecrets | null> {
  const k = await loadKeytar();
  const raw = await k.getPassword(activeService(), authKey(username));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProfileSecrets(parsed) ? (parsed as ProfileSecrets) : null;
  } catch {
    return null;
  }
}

/** Write (or overwrite) the merged profile-auth item. */
export async function setProfileSecrets(username: string, secrets: ProfileSecrets): Promise<void> {
  const k = await loadKeytar();
  await k.setPassword(activeService(), authKey(username), JSON.stringify(secrets));
}

/** Remove the merged profile-auth item. */
export async function deleteProfileSecrets(username: string): Promise<void> {
  const k = await loadKeytar();
  await k.deletePassword(activeService(), authKey(username));
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
