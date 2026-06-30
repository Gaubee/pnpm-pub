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
import type {
	TrustedPublisherConfig,
	TrustedPublisherPermission,
	GithubActionsPublisher,
	CircleCiPublisher,
	GitlabCiPublisher,
} from '../shared/index.js';

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

/** Strict parse of one trusted-publisher config; null for unknown shapes. */
export function parseTrustedPublisher(value: unknown): TrustedPublisherConfig | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const v = value as Record<string, unknown>;
	const type = v.type;
	const claims = v.claims;
	if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) return null;
	const c = claims as Record<string, unknown>;
	// environment lives INSIDE claims (per npm /trust schema), not at top level.
	const environment = typeof c.environment === 'string' ? c.environment : undefined;
	const id = typeof v.id === 'string' ? v.id : undefined;
	// permissions is required; default to both when the registry omits it.
	const rawPerms = Array.isArray(v.permissions) ? v.permissions : [];
	const permissions: TrustedPublisherPermission[] = rawPerms
		.filter((p): p is TrustedPublisherPermission => p === 'createPackage' || p === 'createStagedPackage');
	const perms = permissions.length > 0 ? permissions : (['createPackage', 'createStagedPackage'] as const);

	const base = { id, permissions: [...perms] };
	if (type === 'github') {
		const repo = c.repository;
		const file = (c.workflow_ref as Record<string, unknown> | undefined)?.file;
		if (typeof repo !== 'string' || typeof file !== 'string') return null;
		const claimsOut: GithubActionsPublisher['claims'] = { repository: repo, workflow_ref: { file } };
		if (environment) claimsOut.environment = environment;
		return { type: 'github', ...base, claims: claimsOut };
	}
	if (type === 'circleci') {
		const repo = c.repository;
		if (typeof repo !== 'string') return null;
		const ctx = typeof c.context === 'string' ? c.context : undefined;
		const claimsOut: CircleCiPublisher['claims'] = { repository: repo };
		if (ctx) claimsOut.context = ctx;
		if (environment) claimsOut.environment = environment;
		return { type: 'circleci', ...base, claims: claimsOut };
	}
	if (type === 'gitlab') {
		const project = c.project;
		if (typeof project !== 'string') return null;
		const ref = typeof c.ref === 'string' ? c.ref : undefined;
		const claimsOut: GitlabCiPublisher['claims'] = { project };
		if (ref) claimsOut.ref = ref;
		if (environment) claimsOut.environment = environment;
		return { type: 'gitlab', ...base, claims: claimsOut };
	}
	return null;
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
