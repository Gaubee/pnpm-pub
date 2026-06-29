export interface TokenApplyResponse {
	ok: boolean;
	needsManualToken?: boolean;
	error?: string;
}

export interface ExportResponse {
	ok: boolean;
	bundle?: unknown;
	error?: string;
}

export interface ImportResponse {
	ok: boolean;
	imported?: string[];
	error?: string;
}

export interface OkResponse {
	ok: boolean;
}

export interface NpmProfileLookupResponse {
	ok: boolean;
	profile?: {
		username: string;
		registry: string;
		avatarUrl: string | null;
		source: 'authenticated-profile' | 'registry-profile' | 'maintainer-gravatar' | 'none';
	};
	error?: string;
}

export function parseTokenApplyResponse(value: unknown): TokenApplyResponse | null {
	if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
	if (!isOptionalBoolean(value.needsManualToken) || !isOptionalString(value.error)) return null;
	return {
		ok: value.ok,
		needsManualToken: value.needsManualToken,
		error: value.error,
	};
}

export function parseExportResponse(value: unknown): ExportResponse | null {
	if (!isRecord(value) || typeof value.ok !== 'boolean' || !isOptionalString(value.error)) return null;
	return {
		ok: value.ok,
		bundle: value.bundle,
		error: value.error,
	};
}

export function parseImportResponse(value: unknown): ImportResponse | null {
	if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
	if (!isOptionalStringArray(value.imported) || !isOptionalString(value.error)) return null;
	return {
		ok: value.ok,
		imported: value.imported,
		error: value.error,
	};
}

export function parseOkResponse(value: unknown): OkResponse | null {
	if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
	return { ok: value.ok };
}

export function parseNpmProfileLookupResponse(value: unknown): NpmProfileLookupResponse | null {
	if (!isRecord(value) || typeof value.ok !== 'boolean' || !isOptionalString(value.error)) return null;
	if (value.profile === undefined) return { ok: value.ok, error: value.error };
	if (!isRecord(value.profile)) return null;
	const source = value.profile.source;
	if (
		typeof value.profile.username !== 'string' ||
		typeof value.profile.registry !== 'string' ||
		!isOptionalNullableString(value.profile.avatarUrl) ||
		(source !== 'authenticated-profile' &&
			source !== 'registry-profile' &&
			source !== 'maintainer-gravatar' &&
			source !== 'none')
	) {
		return null;
	}
	return {
		ok: value.ok,
		profile: {
			username: value.profile.username,
			registry: value.profile.registry,
			avatarUrl: value.profile.avatarUrl ?? null,
			source,
		},
		error: value.error,
	};
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
	return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
	return value === undefined || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
