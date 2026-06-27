/**
 * Feature: WebUI REST response decoding
 *
 * Scenario: Given daemon REST response bodies, when WebUI routes decode them,
 * then only proven response shapes drive route state.
 */
import { describe, expect, it } from 'vitest';
import {
	parseExportResponse,
	parseImportResponse,
	parseOkResponse,
	parseTokenApplyResponse,
} from '../../webui/src/lib/rest-response.js';

describe('Feature: WebUI REST response decoding', () => {
	it('Scenario: Given a token apply fallback response, When decoding, Then the typed response is returned', () => {
		expect(parseTokenApplyResponse({ ok: false, needsManualToken: true, error: 'captcha required' })).toEqual({
			ok: false,
			needsManualToken: true,
			error: 'captcha required',
		});
	});

	it('Scenario: Given an invalid token apply response, When decoding, Then the body is rejected', () => {
		expect(parseTokenApplyResponse({ ok: 'false', needsManualToken: true })).toBeNull();
	});

	it('Scenario: Given an export response with an opaque bundle, When decoding, Then the bundle stays opaque', () => {
		const bundle = { profiles: ['alice'], ciphertext: 'hex' };
		expect(parseExportResponse({ ok: true, bundle })).toEqual({ ok: true, bundle, error: undefined });
	});

	it('Scenario: Given an import response with malformed imported names, When decoding, Then the body is rejected', () => {
		expect(parseImportResponse({ ok: true, imported: ['alice', 42] })).toBeNull();
	});

	it('Scenario: Given a workspace confirmation response, When decoding, Then only boolean ok is accepted', () => {
		expect(parseOkResponse({ ok: true })).toEqual({ ok: true });
		expect(parseOkResponse({ ok: 'true' })).toBeNull();
	});
});
