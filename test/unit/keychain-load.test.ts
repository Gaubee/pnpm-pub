/**
 * Feature: keychain runtime module boundary
 *
 * Scenario: Given a malformed runtime keytar module, when loading keytar, then
 * the daemon rejects it before credentials can flow through the adapter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: { requiredModule: unknown } = { requiredModule: {} };
  const requireFn = (id: string): unknown => {
    expect(id).toContain('prebuilds/keytar/lib/keytar.js');
    return state.requiredModule;
  };
  return { state, requireFn };
});

vi.mock('node:fs', () => ({
  default: {
    existsSync: () => true,
  },
}));

vi.mock('node:module', () => ({
  createRequire: () => mocks.requireFn,
}));

describe('Feature: keychain runtime module boundary', () => {
  afterEach(() => {
    vi.resetModules();
    mocks.state.requiredModule = {};
  });

  it('Scenario: Given malformed keytar module output, When loading, Then the credential adapter fails closed', async () => {
    const { loadKeytar } = await import('../../src/daemon/keychain.js');

    await expect(loadKeytar()).rejects.toThrow('Loaded @github/keytar module does not expose the required credential API.');
  });
});
