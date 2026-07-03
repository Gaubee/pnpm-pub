/**
 * Typed boundary around the Profile/Login APIs of `safe-npm-sdk`.
 *
 * Historically this wrapped the `npm-profile` package directly; the SDK now
 * bundles a faithful, better-typed port of the same registry flows (couch
 * login, `GET /-/npm/v1/user`), so this module is the single place that maps
 * the SDK's never-throws `Result` model back into the guarded, throwing
 * boundary the rest of the daemon expects. Callers (applyToken, avatar,
 * web-server) keep their existing exception-based contract.
 *
 * Error model: the SDK returns `Result<T>` and surfaces structured
 * `NpmApiError` subclasses (auth-OTP, auth-IP, general…). `unwrapResult()`
 * turns an `err` into a thrown `NpmApiError`, and `resultErrorMessage` /
 * `isManualTokenFallbackError` let `applyToken` decide its fallback path.
 */
import {
  createClient,
  getProfile,
  loginCouch,
  NpmApiError,
  NpmApiErrorAuthIPAddress,
  NpmApiErrorAuthOTP,
  tfaIsOtpauth,
  tfaIsRecoveryCodes,
  type CouchLoginResult,
  type NpmClient,
  type OtpOptions,
  type Profile,
  type Result,
  type Tfa,
} from "safe-npm-sdk";

export { NpmApiError, NpmApiErrorAuthOTP, NpmApiErrorAuthIPAddress };

export interface NpmProfileAuthenticatedUser {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Full authenticated profile projection — the fields the registry's profile
 * document exposes that are useful to render on the Profile detail page.
 * Sensitive or volatile fields (password, token) are intentionally excluded.
 */
export interface NpmProfileDetail {
  name: string | null;
  fullname: string | null;
  email: string | null;
  emailVerified: boolean | null;
  github: string | null;
  twitter: string | null;
  homepage: string | null;
  tfaEnabled: boolean | null;
  createdAt: string | null;
}

export interface NpmProfileSession {
  token: string;
  username: string | null;
}

export interface NpmProfileAuthOptions {
  registry: string;
  otp?: string;
}

/**
 * Unwrap a {@link Result}: return its `data` on success, throw the SDK's
 * `NpmApiError` on failure. This restores the throw-based contract the rest of
 * the daemon relies on while preserving the structured error subclass
 * (`NpmApiErrorAuthOTP`, `NpmApiErrorAuthIPAddress`, …) the SDK already
 * reifies on `result.error`.
 */
function unwrapResult<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw result.error;
}

/** Human-readable message from a thrown/caught error (NpmApiError or otherwise). */
export function resultErrorMessage(error: unknown): string {
  if (error instanceof NpmApiError) {
    return error.message || `npm registry error (HTTP ${error.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a login error should trigger the manual-token fallback (Chapter 8.1):
 * a rate-limit / captcha / IP or OTP refusal where NPM silently refuses the
 * silent token apply. Mirrors the old `shouldFallbackToManualToken` semantics.
 */
export function isManualTokenFallbackError(error: unknown): boolean {
  if (error instanceof NpmApiErrorAuthOTP) return true;
  if (error instanceof NpmApiErrorAuthIPAddress) return true;
  if (error instanceof NpmApiError) {
    return error.status === 401 || error.status === 403 || error.status === 429;
  }
  return false;
}

/** Build an anonymous client scoped to a registry (login needs no token). */
function anonymousClient(registry: string): NpmClient {
  return createClient({ registry });
}

/** Build an authenticated client scoped to a registry. */
function authedClient(token: string, registry: string): NpmClient {
  return createClient({ auth: { token }, registry });
}

export async function loginWithPassword(
  username: string,
  password: string,
  options: NpmProfileAuthOptions,
): Promise<NpmProfileSession> {
  const opts: OtpOptions = options.otp ? { otp: options.otp } : {};
  const result = await loginCouch(username, password, opts, anonymousClient(options.registry));
  const data: CouchLoginResult = unwrapResult(result);
  const token = readString(data.token);
  if (!token) {
    throw new Error("npm registry login returned no token.");
  }
  return {
    token,
    username: readString(data.name),
  };
}

export async function readAuthenticatedProfile(
  token: string,
  registry: string,
): Promise<NpmProfileAuthenticatedUser> {
  const profile = await fetchProfile(token, registry);
  return {
    name: readString(profile.name),
    email: readString(profile.email),
    avatarUrl: null,
  };
}

/** Read the full authenticated profile (name/email/social/tfa/created). */
export async function readProfileDetail(
  token: string,
  registry: string,
): Promise<NpmProfileDetail> {
  const profile = await fetchProfile(token, registry);
  return {
    name: readString(profile.name),
    fullname: readString(profile.fullname),
    email: readString(profile.email),
    emailVerified: typeof profile.email_verified === "boolean" ? profile.email_verified : null,
    github: readString(profile.github),
    twitter: readString(profile.twitter),
    homepage: readString(profile.homepage),
    tfaEnabled: tfaEnabled(profile.tfa),
    createdAt: readString(profile.created),
  };
}

/** Shared `getProfile` call + unwrap for both projections. */
async function fetchProfile(token: string, registry: string): Promise<Profile> {
  return unwrapResult(await getProfile(authedClient(token, registry)));
}

/**
 * Derive whether 2FA is enabled from the polymorphic `tfa` field. The SDK's
 * `tfaIsOtpauth`/`tfaIsRecoveryCodes` helpers distinguish the setup-in-progress
 * (otpauth URL) and recovery-code shapes; otherwise a `{ mode }` object means
 * enabled, `null`/`false` means disabled.
 */
function tfaEnabled(tfa: Tfa | undefined): boolean | null {
  if (tfa === undefined || tfa === null || tfa === false) return false;
  if (tfaIsOtpauth(tfa) || tfaIsRecoveryCodes(tfa)) return true;
  if (typeof tfa === "object" && "mode" in tfa) return true;
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value.trim() : null;
}
