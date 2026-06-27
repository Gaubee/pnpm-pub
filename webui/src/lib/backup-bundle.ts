import type { BackupBundle } from './types.js';

export type BackupBundleParseResult =
	| { ok: true; bundle: BackupBundle }
	| { ok: false; reason: 'invalid-json' | 'invalid-shape' };

export function parseBackupBundleJson(text: string): BackupBundleParseResult {
	try {
		const parsed: unknown = JSON.parse(text);
		return isBackupBundle(parsed) ? { ok: true, bundle: parsed } : { ok: false, reason: 'invalid-shape' };
	} catch {
		return { ok: false, reason: 'invalid-json' };
	}
}

function isBackupBundle(value: unknown): value is BackupBundle {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyStringArray(value.profiles) &&
		typeof value.salt === 'string' &&
		typeof value.iv === 'string' &&
		typeof value.ciphertext === 'string'
	);
}

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
