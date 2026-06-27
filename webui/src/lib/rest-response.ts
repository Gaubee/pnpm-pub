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

function isOptionalStringArray(value: unknown): value is string[] | undefined {
	return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
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
