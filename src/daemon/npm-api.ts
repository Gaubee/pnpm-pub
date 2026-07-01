/**
 * NPM Registry API client (Chapter 5.4, 8.1, 8.3, 8.4).
 *
 * All write operations are funnelled through here so the daemon can keep a
 * single chokepoint for credentials, error parsing, and clock-drift recovery.
 * Login/token creation is delegated to `npm-profile`; publish/OIDC operations
 * stay on raw registry fetches so Verdaccio and the real registry share the
 * same wire format.
 */
import { Buffer } from 'node:buffer';
import { generateTotp, totpAfterDrift, parseHttpDate } from './totp.js';
import { burnBuffer } from './totp.js';
import { loginWithPassword, isManualTokenFallbackError, resultErrorMessage } from './npm-profile-client.js';
import {
  createClient,
  publish as sdkPublish,
  buildPublishPackument,
  unpublishPackage as sdkUnpublish,
  verifyCredentials as sdkVerifyCredentials,
  type VerificationResult,
} from 'safe-npm-sdk';

export interface RegistryConfig {
  registry: string;
  token: string;
  totpSecret: string;
}

export interface PublishResult {
  ok: boolean;
  status: number;
  /** Parsed NPM error message (best-effort). */
  error?: string;
  /** True when a clock-drift retry path was taken and succeeded (Chapter 8.4). */
  clockDriftRecovered?: boolean;
  /**
   * True when the registry rejected the request because the auth token is
   * expired/revoked/invalid (Chapter 6.2.4 — surfaces as an Expired event so
   * the UI can prompt for renewal instead of a generic failure).
   */
  expired?: boolean;
  stdout: string;
  stderr: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
}

function parseNpmErrorLike(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const message = nonEmptyString(value.message);
  if (message) return message;

  const error = nonEmptyString(value.error);
  const reason = nonEmptyString(value.reason);
  if (error && reason && error !== reason) return `${error}: ${reason}`;
  if (error) return error;
  if (reason) return reason;

  const summary = nonEmptyString(value.summary);
  const detail = nonEmptyString(value.detail);
  if (summary && detail && summary !== detail) return `${summary}: ${detail}`;
  return summary ?? detail;
}

/** Extract the human-readable error string from a known NPM registry error body. */
function parseNpmError(body: unknown): string | undefined {
  const direct = parseNpmErrorLike(body);
  if (direct) return direct;

  if (!isRecord(body) || !Array.isArray(body.errors)) return undefined;
  for (const entry of body.errors) {
    const message = parseNpmErrorLike(entry);
    if (message) return message;
  }
  return undefined;
}

function parseTokenResponse(body: unknown): { token?: string } {
  if (!isRecord(body)) return {};
  const token = nonEmptyString(body.token);
  return token ? { token } : {};
}

function bodyToText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  try {
    return JSON.stringify(body) ?? '';
  } catch {
    return String(body);
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return bodyToText(error);
}

const OTP_FAILED_PATTERNS = [
  /otp validation failed/i,
  /one-time pass/i,
  /otp required/i,
];

function isOtpFailure(body: unknown, status: number): boolean {
  if (status === 403 || status === 401) {
    const text = bodyToText(body);
    return OTP_FAILED_PATTERNS.some((re) => re.test(text));
  }
  return false;
}

// ---------------------------------------------------------------------------
// 8.1 — Automated token apply (silent login)
// ---------------------------------------------------------------------------

/**
 * Exchange username/password(+otp) for the npm auth token returned by
 * `npm-profile` login (Chapter 8.1). Profile/email/avatar resolution is a
 * projection layer concern and must not decide whether the token fact exists.
 *
 * The password Buffer is overwritten with zeros after the request is sent.
 *
 * Returns `{ ok, token }` on success or `{ ok:false, needsManualToken }` when
 * NPM silently rejects (rate limit / captcha) so the UI can show the fallback.
 */
export async function applyToken(opts: {
  registry: string;
  username: string;
  password: string;
  totpSecret: string;
}): Promise<{
  ok: boolean;
  token?: string;
  needsManualToken?: boolean;
  error?: string;
}> {
  const { registry, username, totpSecret } = opts;
  const pwBuf = Buffer.from(opts.password, 'utf8');
  try {
    const otp = generateTotp(totpSecret);
    const password = pwBuf.toString('utf8');
    const session = await loginWithPassword(username, password, { registry, otp });
    return {
      ok: true,
      token: session.token,
    };
  } catch (err) {
    if (isManualTokenFallbackError(err)) {
      return { ok: false, needsManualToken: true, error: resultErrorMessage(err) };
    }
    return { ok: false, error: resultErrorMessage(err) };
  } finally {
    burnBuffer(pwBuf); // burn-after-read for the local buffer; the SDK receives a JS string.
  }
}

async function readRegistryBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 8.3 / 5.4.4 — Publish via the npm registry publish wire format
// ---------------------------------------------------------------------------

/**
 * Publish a package. `tarball` is the raw `.tgz` bytes produced by `pnpm pack`.
 *
 * Uses the canonical npm publish document: a PUT to `/<name>` whose body is a
 * JSON object with the packument metadata plus `_attachments` containing the
 * base64-encoded tarball and its integrity digest. This is exactly what
 * `npm publish` / `pnpm publish` send, so Verdaccio and the real registry both
 * accept it (Chapter 1.3.1).
 *
 * On a 403 OTP failure we inspect the response Date header, compute the clock
 * drift, and retry once with a corrected TOTP (Chapter 8.4).
 */
export async function publishPackage(opts: {
  registry: string;
  token: string;
  totpSecret: string;
  name: string;
  version: string;
  tarball: Buffer;
  metadata: Record<string, unknown>;
  distTag?: string;
  access?: string;
  /** One-shot OTP supplied by the CLI for this publish request. */
  otp?: string;
}): Promise<PublishResult> {
  const { registry, token, totpSecret, name, tarball, metadata } = opts;

  const version = String(metadata.version ?? opts.version);
  const registryBase = registry.replace(/\/$/, '');

  // Build the canonical npm publish packument via the SDK's pure builder
  // (computes sha512 integrity + sha1 shasum, handles scoped tarball naming,
  // assembles _id/dist-tags/versions/_attachments/access). Same shape npm
  // publish / pnpm publish send, so Verdaccio and the real registry both
  // accept it (Chapter 1.3.1).
  const packument = await buildPublishPackument(metadata, tarball, {
    registry: registryBase,
    ...(opts.distTag ? { tag: opts.distTag } : {}),
    ...(opts.access === 'public' || opts.access === 'restricted' ? { access: opts.access } : {}),
  });

  // Construct a one-shot SDK client.
  const client = createClient({ auth: { token }, registry: registryBase });

  const explicitOtp = nonEmptyString(opts.otp);
  const otp = explicitOtp ?? generateTotp(totpSecret);

  // Publish via the SDK — it handles auth headers, OTP, retries, response parsing.
  const result = await sdkPublish(name, packument, { otp }, client);

  if (result.ok) {
    return {
      ok: true,
      status: result.response.status,
      stdout: `[publish] + ${name}@${version}`,
      stderr: '',
    };
  }

  const errorStatus = result.error.status;
  const errorMsg = result.error.message;
  const errorBody = result.error.body;

  // Chapter 6.2.4: an expired/invalid/revoked token is NOT a generic failure.
  if (isExpiredToken(errorStatus, errorBody)) {
    return { ok: false, status: errorStatus, error: errorMsg, stdout: '', stderr: bodyToText(errorBody), expired: true };
  }

  if (explicitOtp) {
    return { ok: false, status: errorStatus, error: errorMsg, stdout: '', stderr: bodyToText(errorBody) };
  }

  // Clock-drift recovery (Chapter 8.4): retry ONLY on OTP failures.
  if (isOtpFailure(errorBody, errorStatus)) {
    const serverMs = parseHttpDate(result.response.headers.get('date'));
    if (serverMs !== null) {
      const correctedOtp = totpAfterDrift(totpSecret, serverMs);
      const retry = await sdkPublish(name, packument, { otp: correctedOtp }, client);
      if (retry.ok) {
        return { ok: true, status: retry.response.status, stdout: `[publish+drift] + ${name}@${version}`, stderr: '', clockDriftRecovered: true };
      }
      return { ok: false, status: retry.error.status, error: retry.error.message, stdout: '', stderr: bodyToText(retry.error.body) };
    }
  }

  return { ok: false, status: errorStatus, error: errorMsg, stdout: '', stderr: bodyToText(errorBody) };
}

// ---------------------------------------------------------------------------
// 8.5 — OIDC / Trusted Publish binding
// ---------------------------------------------------------------------------

/**
 * Configure Trusted Publish (provenance) prerequisites for a package on NPM.
 *
 * NPM provenance is established at *publish* time via the `--provenance` flag
 * from an OIDC-enabled GitHub Actions environment — there is no separate
 * "enable provenance" REST endpoint. The real prerequisite this daemon CAN set
 * is the **2FA-required** flag on the package (which the npm registry exposes
 * at `POST /-/package/<scope>/<name>/-volatile/2fa-required`), so that
 * provenance-bound publishes from CI are the only path.
 *
 * The GitHub Actions workflow (with `--provenance`) is emitted separately by
 * oidc-template.ts. This function therefore performs the registry-side half of
 * "Setup OIDC" (Chapter 8.5 step 9) using a genuine npm endpoint.
 */
export async function configureOidc(opts: {
  registry: string;
  token: string;
  totpSecret: string;
  name: string;
}): Promise<PublishResult> {
  const { registry, token, totpSecret, name } = opts;
  // 2fa-required endpoint: scope and name are URL-encoded, scope keeps its '@'.
  const scoped = name.startsWith('@');
  const encoded = scoped ? name.replace(/^@([^/]+)\//, '@$1%2F') : encodeURIComponent(name);
  const url = `${registry.replace(/\/$/, '')}/-/package/${encoded}/-volatile/2fa-required`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'npm-otp': generateTotp(totpSecret),
    },
  });
  const body = await readRegistryBody(res);
  return {
    ok: res.ok,
    status: res.status,
    error: res.ok ? undefined : (parseNpmError(body) ?? `HTTP ${res.status}`),
    stdout: res.ok ? `[oidc] enabled provenance for ${name}` : '',
    stderr: res.ok ? '' : bodyToText(body),
  };
}

/** Detect whether an error indicates the auth token has expired (Chapter 6.2.4). */
export function isExpiredToken(status: number, body: unknown): boolean {
  if (status === 401) return true;
  if (status === 403) {
    const text = bodyToText(body);
    return /token.*(expired|invalid|revoked)|unauthor/i.test(text) && !isOtpFailure(body, status);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Unpublish (remove a single live-published version)
// ---------------------------------------------------------------------------
// Delegated to the SDK's `unpublishPackage`, which implements npm's
// CouchDB revision-doc protocol (GET _rev → PUT trimmed packument → GET fresh
// _rev → DELETE tarball; whole-package DELETE when it was the only version).
// See Gaubee/safe-npm-sdk#1 + the unpublish operation shipped in d02c2d1.

export interface UnpublishResult {
  ok: boolean;
  status: number;
  error?: string;
  /** True if the whole-package document was removed (no versions remained). */
  wholePackageRemoved?: boolean;
}

/**
 * Remove a single published version from the registry. If it is the only
 * version, the entire package document is deleted instead.
 */
export async function unpublishVersion(opts: {
  registry: string;
  token: string;
  totpSecret: string;
  name: string;
  version: string;
  /** One-shot OTP (overrides the TOTP derived from the secret). */
  otp?: string;
}): Promise<UnpublishResult> {
  const otp = opts.otp ?? generateTotp(opts.totpSecret);
  const client = createClient({ auth: { token: opts.token }, registry: opts.registry });
  const result = await sdkUnpublish(opts.name, opts.version, { otp }, client);
  if (result.ok) {
    return { ok: true, status: result.response.status, wholePackageRemoved: result.data.packageRemoved };
  }
  return { ok: false, status: result.error.status, error: result.error.message };
}

// ---------------------------------------------------------------------------
// Credential verification (side-effect-free auth + OTP check)
// ---------------------------------------------------------------------------
// Delegated to the SDK's verifyCredentials: listTokens() proves the token is
// valid (read-only), and a deleteToken() against a phantom id proves the OTP
// is accepted (the registry checks OTP before the token lookup, so a correct
// OTP yields 404 "not found" while a wrong one yields 401). No real token is
// ever touched. Used by add-profile / re-auth to confirm credentials before
// committing them.

export interface CredentialCheck {
  /** The auth token is valid and accepted by the registry. */
  authValid: boolean;
  /** 2FA is required for this account (a write was rejected without OTP). */
  requires2FA: boolean;
  /** The supplied OTP was accepted. `null` when no OTP was supplied. */
  otpValid: boolean | null;
  /** Human-readable summary for logging / UI. */
  message: string;
}

export interface VerifyCredentialsResult {
  ok: boolean;
  status: number;
  error?: string;
  check?: CredentialCheck;
}

/**
 * Verify that a token (+ optionally its TOTP) work, without side effects.
 * Pass the raw token + TOTP secret; the OTP is derived from the secret.
 */
export async function verifyCredentials(opts: {
  registry: string;
  token: string;
  totpSecret: string;
}): Promise<VerifyCredentialsResult> {
  const client = createClient({ auth: { token: opts.token }, registry: opts.registry });
  const otp = generateTotp(opts.totpSecret);
  const result = await sdkVerifyCredentials(client, { otp });
  if (result.ok) {
    const v: VerificationResult = result.data;
    return {
      ok: true,
      status: result.response.status,
      check: {
        authValid: v.authValid,
        requires2FA: v.requires2FA,
        otpValid: v.otpValid,
        message: v.message,
      },
    };
  }
  return { ok: false, status: result.error.status, error: result.error.message };
}
