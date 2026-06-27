/**
 * Feature: WebUI error projection
 *
 * Scenario: Given route catch boundaries, when a thrown value is not an Error,
 * then the visible error text preserves the source value.
 */
import { describe, expect, it } from 'vitest';
import { errorToMessage } from '../../webui/src/lib/error-projection.js';

describe('Feature: WebUI error projection', () => {
	it('Scenario: Given an Error, When projecting route error text, Then the message is used', () => {
		expect(errorToMessage(new Error('network down'))).toBe('network down');
	});

	it('Scenario: Given a non-Error, When projecting route error text, Then the source text is preserved', () => {
		expect(errorToMessage('fetch aborted')).toBe('fetch aborted');
	});
});
