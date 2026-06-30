/**
 * npm Trusted Publishing (OIDC) trusted-publisher management — npm's
 * `/-/package/{name}/trust` endpoints (Chapter 8.5).
 *
 * Three operations mirror the web UI on npmjs.com → package settings →
 * Publishing access → trusted publishers:
 *   - listTrustedPublishers   (GET)
 *   - addTrustedPublisher     (POST)
 *   - removeTrustedPublisher  (DELETE by config id)
 *
 * All require an npm Bearer token + a 2FA OTP. The OTP is generated from the
 * keychain TOTP secret (same mechanism as publish). Response parsing is strict
 * (unknown provider `type` is rejected) so the webui's discriminated union
 * stays sound.
 *
 * Wire shape (https://api-docs.npmjs.com/):
 *   config = { id, type, claims:{ repository, environment?, ... }, permissions:[] }
 *   GET  response body = TrustedPublisherConfig[]   (top-level array)
 *   POST request body  = TrustedPublisherConfig      (single config)
 *   DELETE            = /trust/{config-uuid}
 * `environment` lives INSIDE `claims` (not at config top level).
 */
import { generateTotp } from './totp.js';
import { TrustedPublisherConfigSchema } from '../shared/schemas.js';
import type { TrustedPublisherConfig } from '../shared/index.js';

export interface TrustAuth {
	registry: string;
	token: string;
	totpSecret: string;
}

export interface TrustResult {
	ok: boolean;
	status: number;
	/** Human-readable error (best-effort). */
	error?: string;
}

/** Encode a (possibly scoped) package name for the `/trust` URL segment. */
function encodePackageName(name: string): string {
	const scoped = name.startsWith('@');
	return scoped ? name.replace(/^@([^/]+)\//, '@$1%2F') : encodeURIComponent(name);
}

function trustUrl(registry: string, name: string, suffix = ''): string {
	return `${registry.replace(/\/$/, '')}/-/package/${encodePackageName(name)}/trust${suffix}`;
}

async function readBody(res: Response): Promise<unknown> {
	try {
		const text = await res.text();
		if (!text) return null;
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return text;
		}
	} catch {
		return null;
	}
}

function parseNpmError(body: unknown): string | undefined {
	if (typeof body === 'string' && body.length > 0) return body;
	if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
		const record = body as Record<string, unknown>;
		const msg = typeof record.message === 'string' ? record.message : undefined;
		if (msg) return msg;
		const error = typeof record.error === 'string' ? record.error : undefined;
		if (error) return error;
	}
	return undefined;
}

/** Parse one trusted-publisher config via Zod; null for unknown shapes. */
export function parseTrustedPublisher(value: unknown): TrustedPublisherConfig | null {
	const result = TrustedPublisherConfigSchema.safeParse(value);
	return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// GET — list trusted publishers for a package
// ---------------------------------------------------------------------------

export async function listTrustedPublishers(
	auth: TrustAuth,
	name: string,
): Promise<{ ok: true; configs: TrustedPublisherConfig[] } | { ok: false; status: number; error: string }> {
	// GET also requires the npm-otp header per the API docs.
	const res = await fetch(trustUrl(auth.registry, name), {
		method: 'GET',
		headers: {
			authorization: `Bearer ${auth.token}`,
			'npm-otp': generateTotp(auth.totpSecret),
		},
	});
	const body = await readBody(res);
	if (!res.ok) {
		return { ok: false, status: res.status, error: parseNpmError(body) ?? `HTTP ${res.status}` };
	}
	// The list endpoint returns a TOP-LEVEL array of configs.
	const list = Array.isArray(body)
		? body.map(parseTrustedPublisher).filter((c): c is TrustedPublisherConfig => c !== null)
		: [];
	return { ok: true, configs: list };
}

// ---------------------------------------------------------------------------
// POST — add a trusted publisher
// ---------------------------------------------------------------------------

export async function addTrustedPublisher(
	auth: TrustAuth,
	name: string,
	config: TrustedPublisherConfig,
): Promise<TrustResult> {
	const res = await fetch(trustUrl(auth.registry, name), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${auth.token}`,
			'npm-otp': generateTotp(auth.totpSecret),
		},
		body: JSON.stringify(config),
	});
	const body = await readBody(res);
	return {
		ok: res.ok,
		status: res.status,
		error: res.ok ? undefined : parseNpmError(body) ?? `HTTP ${res.status}`,
	};
}

// ---------------------------------------------------------------------------
// DELETE — remove a trusted publisher by config id
// ---------------------------------------------------------------------------

export async function removeTrustedPublisher(
	auth: TrustAuth,
	name: string,
	uuid: string,
): Promise<TrustResult> {
	const res = await fetch(trustUrl(auth.registry, name, `/${encodeURIComponent(uuid)}`), {
		method: 'DELETE',
		headers: {
			authorization: `Bearer ${auth.token}`,
			'npm-otp': generateTotp(auth.totpSecret),
		},
	});
	const body = await readBody(res);
	return {
		ok: res.ok,
		status: res.status,
		error: res.ok ? undefined : parseNpmError(body) ?? `HTTP ${res.status}`,
	};
}
