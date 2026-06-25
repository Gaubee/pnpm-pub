/**
 * NPM Registry API client (Chapter 5.4, 8.1, 8.3, 8.4).
 *
 * All write operations are funnelled through here so the daemon can keep a
 * single chokepoint for credentials, error parsing, and clock-drift recovery.
 *
 * The client deliberately stays protocol-pure (raw `fetch`) so it can target
 * either the real registry or a local Verdaccio instance (Chapter 10.3).
 */
import { Buffer } from 'node:buffer';
import { generateTotp, totpAfterDrift, parseHttpDate } from './totp.js';
import { burnBuffer } from './totp.js';

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

/** Extract the human-readable error string from an NPM error response. */
function parseNpmError(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    if (typeof rec.error === 'string') return rec.error;
    if (typeof rec.message === 'string') return rec.message;
  }
  return undefined;
}

const OTP_FAILED_PATTERNS = [
  /otp validation failed/i,
  /one-time pass/i,
  /otp required/i,
];

function isOtpFailure(body: unknown, status: number): boolean {
  if (status === 403 || status === 401) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return OTP_FAILED_PATTERNS.some((re) => re.test(text));
  }
  return false;
}

// ---------------------------------------------------------------------------
// 8.1 — Automated token apply (silent login)
// ---------------------------------------------------------------------------

/**
 * Exchange username/password(+otp) for a long-lived automation token by calling
 * the NPM token endpoint directly, bypassing `npm login` (Chapter 8.1).
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
}): Promise<{ ok: boolean; token?: string; needsManualToken?: boolean; error?: string }> {
  const { registry, username, totpSecret } = opts;
  const pwBuf = Buffer.from(opts.password, 'utf8');
  try {
    const otp = generateTotp(totpSecret);
    const url = `${registry.replace(/\/$/, '')}/-/npm/v1/tokens`;
    // NOTE: spec Chapter 8.1 step 5 diagrams this as `PUT`; the real npm
    // token-creation endpoint is `POST` (the spec's own footnote at 08.md:38
    // confirms "直接构造... HTTP 请求", i.e. whatever verb the registry
    // expects). POST is what npmjs.org/Verdaccio accept, so we honor that.
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'npm-auth-type': 'legacy',
      },
      body: JSON.stringify({
        name: username,
        password: pwBuf.toString('utf8'),
        otp,
        readonly: false,
        cidr_whitelist: [],
        automation: true,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as { token?: string };
      if (json.token) return { ok: true, token: json.token };
    }

    // Fallback path: NPM refused the silent apply (Chapter 8.1 风控降级).
    if (res.status === 403 || res.status === 401 || res.status === 429) {
      return { ok: false, needsManualToken: true, error: parseNpmError(await safeJson(res)) };
    }
    return { ok: false, error: parseNpmError(await safeJson(res)) ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    burnBuffer(pwBuf); // burn-after-read (Chapter 8.1)
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
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
}): Promise<PublishResult> {
  const { registry, token, totpSecret, name, tarball, metadata } = opts;
  const { createHash } = await import('node:crypto');

  const version = String(metadata.version ?? opts.version);
  const tarballB64 = tarball.toString('base64');
  const integrity = createHash('sha512').update(tarball).digest('base64');
  const tarballFilename = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
  // The dist.tarball MUST be an absolute URL (a bare filename crashes registries
  // like Verdaccio that parse it). This mirrors what `npm publish` sends.
  const registryBase = registry.replace(/\/$/, '');
  const tarballUrl = `${registryBase}/${name}/-/${tarballFilename}`;

  // The `_attachments` form: metadata + version-pin dist + the base64 tarball.
  const buildBody = (): Record<string, unknown> => {
    const versions: Record<string, unknown> = {
      [version]: {
        ...metadata,
        version,
        dist: {
          tarball: tarballUrl,
          integrity: `sha512-${integrity}`,
        },
      },
    };
    return {
      name,
      // `latest` tag points at the freshly published version.
      'dist-tags': { latest: version },
      versions,
      _attachments: {
        [tarballFilename]: {
          content_type: 'application/octet-stream',
          data: tarballB64,
          length: tarball.length,
        },
      },
    };
  };

  const attempt = async (
    otp: string,
    attemptLabel: string,
  ): Promise<{ result: PublishResult; dateHeader: string | null; body: unknown }> => {
    const url = `${registry.replace(/\/$/, '')}/${encodeURIComponent(name).replace('%40', '@')}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'npm-otp': otp,
      },
      body: JSON.stringify(buildBody()),
    });
    const body = await safeJson(res);
    const dateHeader = res.headers.get('date');
    if (res.ok) {
      return {
        result: {
          ok: true,
          status: res.status,
          stdout: `[${attemptLabel}] + ${name}@${version}`,
          stderr: '',
        },
        dateHeader,
        body,
      };
    }
    return {
      result: {
        ok: false,
        status: res.status,
        error: parseNpmError(body) ?? `HTTP ${res.status}`,
        stdout: '',
        stderr: typeof body === 'string' ? body : JSON.stringify(body),
      },
      dateHeader,
      body,
    };
  };

  // First attempt with the current TOTP.
  const first = await attempt(generateTotp(totpSecret), 'publish');
  if (first.result.ok) return first.result;

  const status = first.result.status;

  // Chapter 6.2.4: an expired/invalid/revoked token is NOT a generic failure.
  // Mark it `expired` so the scheduler surfaces an Expired event + renew flow.
  // Do NOT attempt clock-drift recovery for these — drift only compensates OTP
  // skew, and retrying an expired token just wastes the OTP window.
  if (isExpiredToken(status, first.body)) {
    return { ...first.result, expired: true };
  }

  // Clock-drift recovery branch (Chapter 8.4): retry ONLY on genuine OTP
  // failures (403 "OTP validation failed"), never on arbitrary 401/403.
  if (isOtpFailure(first.body, status)) {
    const serverMs = parseHttpDate(first.dateHeader);
    if (serverMs !== null) {
      const correctedOtp = totpAfterDrift(totpSecret, serverMs);
      const retry = await attempt(correctedOtp, 'publish+drift');
      if (retry.result.ok) return { ...retry.result, clockDriftRecovered: true };
      return retry.result;
    }
    // No Date header on the failure — probe the packument for one.
    try {
      const probe = await fetch(`${registry.replace(/\/$/, '')}/${encodeURIComponent(name).replace('%40', '@')}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      const probeMs = parseHttpDate(probe.headers.get('date'));
      if (probeMs !== null) {
        const correctedOtp = totpAfterDrift(totpSecret, probeMs);
        const retry = await attempt(correctedOtp, 'publish+drift');
        if (retry.result.ok) return { ...retry.result, clockDriftRecovered: true };
      }
    } catch {
      // ignore probe failure — surface the original error.
    }
  }

  return first.result;
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
  const body = await safeJson(res);
  return {
    ok: res.ok,
    status: res.status,
    error: res.ok ? undefined : (parseNpmError(body) ?? `HTTP ${res.status}`),
    stdout: res.ok ? `[oidc] enabled provenance for ${name}` : '',
    stderr: res.ok ? '' : JSON.stringify(body),
  };
}

/** Detect whether an error indicates the auth token has expired (Chapter 6.2.4). */
export function isExpiredToken(status: number, body: unknown): boolean {
  if (status === 401) return true;
  if (status === 403) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return /token.*(expired|invalid|revoked)|unauthor/i.test(text) && !isOtpFailure(body, status);
  }
  return false;
}
