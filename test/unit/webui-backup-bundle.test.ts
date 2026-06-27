/**
 * Feature: WebUI backup bundle decoding
 *
 * Scenario: Given imported backup file text, when WebUI previews/imports it,
 * then only the Chapter 8.2 plaintext wrapper shape is accepted.
 */
import { describe, expect, it } from 'vitest';
import { parseBackupBundleJson } from '../../webui/src/lib/backup-bundle.js';

describe('Feature: WebUI backup bundle decoding', () => {
	it('Scenario: Given a valid backup wrapper, When decoding, Then the bundle is returned', () => {
		const bundle = parseBackupBundleJson(
			JSON.stringify({
				profiles: ['alice', 'work'],
				salt: 'salt-hex',
				iv: 'iv-hex',
				ciphertext: 'ciphertext-hex',
			}),
		);

		expect(bundle).toEqual({
			ok: true,
			bundle: {
				profiles: ['alice', 'work'],
				salt: 'salt-hex',
				iv: 'iv-hex',
				ciphertext: 'ciphertext-hex',
			},
		});
	});

	it('Scenario: Given malformed JSON, When decoding, Then the bundle is rejected', () => {
		expect(parseBackupBundleJson('{bad json')).toEqual({ ok: false, reason: 'invalid-json' });
	});

	it('Scenario: Given an invalid profile list, When decoding, Then the bundle is rejected', () => {
		expect(
			parseBackupBundleJson(
				JSON.stringify({
					profiles: ['alice', ''],
					salt: 'salt-hex',
					iv: 'iv-hex',
					ciphertext: 'ciphertext-hex',
				}),
			),
		).toEqual({ ok: false, reason: 'invalid-shape' });
	});
});
