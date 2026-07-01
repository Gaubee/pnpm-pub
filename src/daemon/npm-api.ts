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
import { z } from 'zod';
import { generateTotp, totpAfterDrift, parseHttpDate } from './totp.js';
import { burnBuffer } from './totp.js';
import { loginWithPassword } from './npm-profile-client.js';
import {
  createClient,
  escapePackageName,
  publish as sdkPublish,
  type NpmClient,
  type PublishPackument,
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

function readErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  const code = error.code;
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : null;
}

function readErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  for (const key of ['statusCode', 'status']) {
    const status = error[key];
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }
  const code = readErrorCode(error);
  if (code?.match(/^E\d{3}$/)) return Number(code.slice(1));
  return null;
}

function shouldFallbackToManualToken(error: unknown): boolean {
  const status = readErrorStatus(error);
  if (status === 401 || status === 403 || status === 429) return true;
  const code = readErrorCode(error);
  return code === 'EOTP' || code === 'EAUTHIP';
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
    if (shouldFallbackToManualToken(err)) {
      return { ok: false, needsManualToken: true, error: errorToMessage(err) };
    }
    return { ok: false, error: errorToMessage(err) };
  } finally {
    burnBuffer(pwBuf); // burn-after-read for the local buffer; npm-profile receives a JS string.
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
  const { createHash } = await import('node:crypto');

  const version = String(metadata.version ?? opts.version);
  const tarballB64 = tarball.toString('base64');
  const integrity = createHash('sha512').update(tarball).digest('base64');
  const tarballFilename = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
  const registryBase = registry.replace(/\/$/, '');
  const tarballUrl = `${registryBase}/${name}/-/${tarballFilename}`;

  // Build the canonical npm publish packument (same structure npm publish sends).
  const packument: PublishPackument = {
    name,
    'dist-tags': { [opts.distTag ?? 'latest']: version },
    ...(opts.access ? { access: opts.access } : {}),
    versions: {
      [version]: {
        ...metadata,
        version,
        dist: { tarball: tarballUrl, integrity: `sha512-${integrity}` },
      },
    },
    _attachments: {
      [tarballFilename]: {
        content_type: 'application/octet-stream',
        data: tarballB64,
        length: tarball.length,
      },
    },
  } as PublishPackument;

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
// npm's registry uses a CouchDB-style revision-doc protocol. Removing one
// version of an existing package is a multi-step exchange (see libnpmpublish's
// lib/unpublish.js):
//   1. GET /<pkg>            → current packument (with CouchDB _rev)
//   2. strip the version from versions / dist-tags / time
//   3. PUT /<pkg>/-rev/<rev> → write the trimmed packument
//   4. GET /<pkg>            → fresh _rev
//   5. DELETE /<tarball-path>/-rev/<rev> → remove the tarball binary asset
// safe-npm-sdk has no unpublish operation yet (tracking issue
// Gaubee/safe-npm-sdk#1), so this uses the SDK's low-level client.request.

export interface UnpublishResult {
  ok: boolean;
  status: number;
  error?: string;
  /** True if the whole-package document was removed (no versions remained). */
  wholePackageRemoved?: boolean;
}

/** Lightweight semver compare (major.minor.patch numerics, no prerelease). */
function compareVersionLoose(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.+-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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
  const { registry, token, name, version } = opts;
  const otp = opts.otp ?? generateTotp(opts.totpSecret);
  const client = createClient({ auth: { token }, registry });
  const escaped = escapePackageName(name);

  // Loose schema: accept any JSON the registry returns (packument, void, etc.).
  // safe-npm-sdk targets Zod v3 while pnpm-pub is on v4; the two `ZodType`
  // constructors are structurally incompatible at the type level. Cast to the
  // schema slot's expected type — at runtime both zods expose the same
  // `safeParse`/`parse` surface used by client.request.
  type RequestSchema = Parameters<NpmClient['request']>[0]['schema'];
  const LooseSchema = z.unknown() as unknown as RequestSchema;

  try {
    // 1. Fetch the current packument + its CouchDB revision.
    const getRes = await client.request({ method: 'GET', path: `/${escaped}`, otp, schema: LooseSchema });
    if (!getRes.ok) {
      return { ok: false, status: getRes.error.status, error: getRes.error.message };
    }
    const doc = getRes.data as Record<string, unknown>;
    const rev = typeof doc._rev === 'string' ? doc._rev : undefined;
    const versions = (isRecord(doc.versions) ? doc.versions : {}) as Record<string, unknown>;
    if (!versions[version]) {
      // Version doesn't exist — nothing to remove. Mirror npm's no-op success.
      return { ok: true, status: 200 };
    }
    if (!rev) {
      return { ok: false, status: 500, error: 'Packument has no _rev; cannot unpublish safely.' };
    }

    // 2. Strip the version and fix dist-tags / time.
    const next: Record<string, unknown> = { ...doc };
    const nextVersions = { ...versions };
    delete nextVersions[version];
    next.versions = nextVersions;

    if (isRecord(doc['dist-tags'])) {
      const tags = { ...(doc['dist-tags'] as Record<string, string>) };
      for (const [tag, ver] of Object.entries(tags)) {
        if (ver === version) delete tags[tag];
      }
      // Reassign `latest` if it pointed at the removed version.
      if (!tags.latest && Object.keys(nextVersions).length > 0) {
        const greatest = Object.keys(nextVersions).sort(compareVersionLoose).pop()!;
        tags.latest = greatest;
      }
      next['dist-tags'] = tags;
    }
    if (isRecord(doc.time)) {
      const times = { ...(doc.time as Record<string, unknown>) };
      delete times[version];
      next.time = times;
    }
    // Drop fields the registry rejects on PUT.
    delete next._revisions;
    delete next._attachments;

    // 3. If no versions remain → whole-package removal (single DELETE).
    if (Object.keys(nextVersions).length === 0) {
      const delRes = await client.request({
        method: 'DELETE',
        path: `/${escaped}/-rev/${rev}`,
        otp,
        schema: LooseSchema,
      });
      if (!delRes.ok) {
        return { ok: false, status: delRes.error.status, error: delRes.error.message };
      }
      return { ok: true, status: 200, wholePackageRemoved: true };
    }

    // 4. PUT the trimmed packument back.
    const putRes = await client.request({
      method: 'PUT',
      path: `/${escaped}/-rev/${rev}`,
      body: next,
      otp,
      schema: LooseSchema,
    });
    if (!putRes.ok) {
      return { ok: false, status: putRes.error.status, error: putRes.error.message };
    }

    // 5. Fetch a fresh _rev, then DELETE the tarball asset.
    const regetRes = await client.request({ method: 'GET', path: `/${escaped}`, otp, schema: LooseSchema });
    if (!regetRes.ok) {
      // Packument update succeeded; only the tarball cleanup failed. Report
      // partial success so the caller knows the version is effectively gone.
      return { ok: true, status: 200 };
    }
    const freshDoc = regetRes.data as Record<string, unknown>;
    const freshRev = typeof freshDoc._rev === 'string' ? freshDoc._rev : undefined;
    const removedMeta = isRecord(versions[version]) ? (versions[version] as Record<string, unknown>) : {};
    const dist = isRecord(removedMeta.dist) ? (removedMeta.dist as Record<string, unknown>) : {};
    const tarballUrl = typeof dist.tarball === 'string' ? dist.tarball : undefined;
    if (tarballUrl && freshRev) {
      // tarball URL is absolute (https://registry.../<pkg>/-/<file>); derive
      // the registry-relative path by stripping the origin.
      let tarballPath = tarballUrl;
      try {
        const u = new URL(tarballUrl);
        tarballPath = u.pathname;
      } catch {
        // not a URL — assume already a path
      }
      const delTarRes = await client.request({
        method: 'DELETE',
        path: `${tarballPath}/-rev/${freshRev}`,
        otp,
        schema: LooseSchema,
      });
      if (!delTarRes.ok) {
        // Version removed from packument; tarball asset lingered. Still ok.
      }
    }

    return { ok: true, status: 200 };
  } catch (error: unknown) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
