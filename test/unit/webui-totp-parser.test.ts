/**
 * WebUI TOTP secret *parser* tests (Chapter 8.1 Add Profile).
 *
 * Distinct from totp.test.ts, which covers the daemon-side RFC code GENERATION
 * (src/daemon/totp.js). This file covers the front-end secret PARSER
 * (webui/src/lib/totp.ts): it accepts many shapes of the same Base32 secret —
 * raw, spaced / hyphenated, an otpauth:// URI, a label|secret line, and a
 * Google Authenticator otpauth-migration:// bundle. It must NEVER throw on
 * malformed input (it runs inside a Svelte `$derived`, where a throw corrupts
 * the reactive graph) and must surface multi-secret bundles so the UI can warn.
 */
import { describe, it, expect } from 'vitest';
import {
	parseTotpSecret,
	parseTotpSecrets,
	coerceTotpSecret,
	totpSecretError,
	isBase32Secret,
} from '../../webui/src/lib/totp.js';

describe('raw Base32 secret', () => {
	it('accepts a clean Base32 string', () => {
		expect(parseTotpSecret('JBSWY3DPEHPK3PXP')?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('strips spaces and hyphens and upper-cases', () => {
		expect(parseTotpSecret('jbsw y3dp-ehpk 3pxp')?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('drops trailing padding', () => {
		expect(parseTotpSecret('JBSWY3DPEHPK3PXP====')?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('rejects an empty string', () => {
		expect(parseTotpSecret('')).toBeNull();
	});

	it('rejects non-Base32 characters', () => {
		expect(parseTotpSecret('not-base32!@#')).toBeNull();
	});
});

describe('otpauth:// URI', () => {
	it('extracts the secret from the query string', () => {
		const uri = 'otpauth://totp/Issuer:acct?secret=JBSWY3DPEHPK3PXP&issuer=Issuer';
		expect(parseTotpSecret(uri)?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('uses the issuer as the label', () => {
		const uri = 'otpauth://totp/Issuer:acct?secret=JBSWY3DPEHPK3PXP&issuer=Issuer';
		expect(parseTotpSecret(uri)?.label).toBe('Issuer');
	});

	it('exposes the account (post-colon path segment) for username auto-fill', () => {
		const uri = 'otpauth://totp/Issuer:john_doe?secret=JBSWY3DPEHPK3PXP&issuer=Issuer';
		expect(parseTotpSecret(uri)?.account).toBe('john_doe');
	});

	it('uses the whole path label as account when there is no colon', () => {
		expect(parseTotpSecret('otpauth://totp/jane?secret=JBSWY3DPEHPK3PXP')?.account).toBe('jane');
	});

	it('rejects an otpauth:// URI whose secret is invalid Base32', () => {
		expect(parseTotpSecret('otpauth://totp/x?secret=not-base32!!')).toBeNull();
	});

	it('rejects a non-totp otpauth scheme (host must be totp)', () => {
		expect(parseTotpSecret('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
	});
});

describe('label|secret and label,secret shorthand', () => {
	it('parses label|secret', () => {
		const parsed = parseTotpSecret('github|JBSWY3DPEHPK3PXP');
		expect(parsed?.secret).toBe('JBSWY3DPEHPK3PXP');
		expect(parsed?.label).toBe('github');
		expect(parsed?.account).toBe('github');
	});

	it('parses label,secret', () => {
		expect(parseTotpSecret('work,jbsw y3dp ehpk 3pxp')?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('rejects shorthand whose secret half is invalid', () => {
		expect(parseTotpSecret('label|!!bad!!')).toBeNull();
	});
});

describe('coerceTotpSecret / isBase32Secret', () => {
	it('normalizes and validates a raw secret only (no URI parsing)', () => {
		expect(coerceTotpSecret(' jbsw-y3dp ')).toBe('JBSWY3DP');
	});

	it('returns null for a URI (coerce is raw-only)', () => {
		expect(coerceTotpSecret('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
	});

	it('isBase32Secret matches clean uppercase Base32', () => {
		expect(isBase32Secret('JBSWY3DPEHPK3PXP')).toBe(true);
		expect(isBase32Secret('jbsw y3dp')).toBe(false);
	});
});

// ---- otpauth-migration:// (Google Authenticator export bundle) ----
// Helpers build a minimal valid protobuf bundle in-process so the tests are
// self-contained. The bundle's repeated field #1 is an OtpParameters message:
// #1 secret bytes, #2 account, #3 issuer, #6 type enum (2 = TOTP).

function b32ToBytes(secret: string): Uint8Array {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;
	for (const char of secret) {
		value = value * 32 + alphabet.indexOf(char);
		bits += 5;
		while (bits >= 8) {
			bits -= 8;
			bytes.push(Math.floor(value / 2 ** bits) & 0xff);
			value %= 2 ** bits;
		}
	}
	return new Uint8Array(bytes);
}

function varint(n: number): Uint8Array {
	const out: number[] = [];
	do {
		let byte = n & 0x7f;
		n >>>= 7;
		if (n > 0) byte |= 0x80;
		out.push(byte);
	} while (n > 0);
	return new Uint8Array(out);
}

function lenDelim(fieldNumber: number, bytes: Uint8Array): Uint8Array {
	const tag = new Uint8Array([(fieldNumber << 3) | 2]);
	return new Uint8Array([...tag, ...varint(bytes.length), ...bytes]);
}

function varintField(fieldNumber: number, value: number): Uint8Array {
	const tag = new Uint8Array([(fieldNumber << 3) | 0]);
	return new Uint8Array([...tag, ...varint(value)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/** Build one OtpParameters message; type defaults to TOTP (2). */
function otpEntry(opts: { secret: string; account?: string; issuer?: string; type?: number }): Uint8Array {
	const parts: Uint8Array[] = [lenDelim(1, b32ToBytes(opts.secret))];
	if (opts.account) parts.push(lenDelim(2, new TextEncoder().encode(opts.account)));
	if (opts.issuer) parts.push(lenDelim(3, new TextEncoder().encode(opts.issuer)));
	parts.push(varintField(6, opts.type ?? 2));
	return concat(parts);
}

/** Wrap one or more OtpParameters into an otpauth-migration:// URI. */
function migrationUri(entries: Uint8Array[]): string {
	const bundle = concat(entries.map((e) => lenDelim(1, e)));
	const data = Buffer.from(bundle).toString('base64url');
	return `otpauth-migration://offline?data=${data}`;
}

describe('otpauth-migration:// bundle', () => {
	it('parses a single TOTP entry', () => {
		const uri = migrationUri([otpEntry({ secret: 'JBSWY3DPEHPK3PXP', account: 'me', issuer: 'Iss' })]);
		const all = parseTotpSecrets(uri);
		expect(all).toHaveLength(1);
		expect(all[0]?.secret).toBe('JBSWY3DPEHPK3PXP');
		expect(all[0]?.label).toBe('Iss / me');
		expect(all[0]?.account).toBe('me');
	});

	it('returns the first secret from a multi-entry bundle', () => {
		const uri = migrationUri([
			otpEntry({ secret: 'JBSWY3DPEHPK3PXP', account: 'one' }),
			otpEntry({ secret: 'KRSXG5CTMVRXEZDU', account: 'two' }),
		]);
		expect(parseTotpSecrets(uri)).toHaveLength(2);
		expect(parseTotpSecret(uri)?.secret).toBe('JBSWY3DPEHPK3PXP');
	});

	it('skips HOTP entries (type=1) and keeps only TOTP (type=2)', () => {
		const uri = migrationUri([
			otpEntry({ secret: 'JBSWY3DPEHPK3PXP', account: 'hotp', type: 1 }), // HOTP — skipped
			otpEntry({ secret: 'KRSXG5CTMVRXEZDU', account: 'totp', type: 2 }), // TOTP — kept
		]);
		const all = parseTotpSecrets(uri);
		expect(all).toHaveLength(1);
		expect(all[0]?.secret).toBe('KRSXG5CTMVRXEZDU');
	});

	it('returns an empty array for a bundle with no TOTP entries', () => {
		const uri = migrationUri([otpEntry({ secret: 'JBSWY3DPEHPK3PXP', account: 'x', type: 1 })]);
		expect(parseTotpSecrets(uri)).toEqual([]);
	});

	it('does NOT throw on malformed migration input (runs inside $derived)', () => {
		// A truncated varint (high bit set, then end of stream) used to throw
		// PROTOBUF_PARSE_ERROR out of parseProtoFields.
		const truncated = Buffer.from(new Uint8Array([0x08, 0x80])).toString('base64url');
		const bad = `otpauth-migration://offline?data=${truncated}`;
		expect(() => parseTotpSecrets(bad)).not.toThrow();
		expect(parseTotpSecrets(bad)).toEqual([]);
	});

	it('returns [] for a migration URI with no data param', () => {
		expect(parseTotpSecrets('otpauth-migration://offline')).toEqual([]);
	});

	it('returns [] for a non-otpauth-migration URL', () => {
		expect(parseTotpSecrets('https://example.com/data=abc')).toEqual([]);
	});
});

describe('totpSecretError (UI hint text)', () => {
	it('is empty for a valid raw secret', () => {
		expect(totpSecretError('JBSWY3DPEHPK3PXP')).toBe('');
	});

	it('reports unsupported format for unparseable input', () => {
		expect(totpSecretError('!!not base32!!')).toMatch(/unsupported|无法|不支持/i);
	});

	it('warns when a bundle has multiple secrets (only first is used)', () => {
		const uri = migrationUri([
			otpEntry({ secret: 'JBSWY3DPEHPK3PXP', account: 'one' }),
			otpEntry({ secret: 'KRSXG5CTMVRXEZDU', account: 'two' }),
		]);
		expect(totpSecretError(uri)).toMatch(/2|first|第一条/i);
	});
});
