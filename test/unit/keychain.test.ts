/**
 * Keychain sandbox tests (Chapter 10.2.1).
 *
 * Security red line: tests MUST use the `pnpm-pub-test-sandbox` service so they
 * never touch the developer's real pnpm-pub credentials. We mock the native
 * @github/keytar surface with an in-memory map.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory keytar stub shared across the test file.
const store = new Map<string, string>();
const key = (service: string, account: string) => `${service}:${account}`;

// The in-memory keytar surface. Injected via __setKeytarForTest so the tests
// don't depend on createRequire's interaction with the module system.
const inMemoryKeytar = {
  async setPassword(service: string, account: string, password: string) {
    store.set(key(service, account), password);
  },
  async getPassword(service: string, account: string) {
    return store.get(key(service, account)) ?? null;
  },
  async deletePassword(service: string, account: string) {
    return store.delete(key(service, account));
  },
  async findCredentials(service: string) {
    const out: { account: string; password: string }[] = [];
    for (const [k, v] of store) {
      if (k.startsWith(`${service}:`)) {
        out.push({ account: k.slice(service.length + 1), password: v });
      }
    }
    return out;
  },
  async findPassword() {
    return null;
  },
};

import {
  setToken,
  getToken,
  setTotpSecret,
  getTotpSecret,
  deleteProfile,
  useSandboxService,
  resetService,
  activeService,
  __setKeytarForTest,
} from '../../src/daemon/keychain.js';
import { KEYCHAIN_SERVICE_SANDBOX } from '../../src/shared/index.js';

describe('Keychain sandbox isolation (Chapter 10.2.1)', () => {
  beforeEach(async () => {
    store.clear();
    useSandboxService();
    // Inject the in-memory keytar surface (Chapter 10.2.1 — never touch the
    // developer's real credentials, and use the sandbox service name).
    __setKeytarForTest(inMemoryKeytar);
  });

  afterEach(() => {
    __setKeytarForTest(null);
    resetService();
  });

  it('uses the sandbox service name', () => {
    expect(activeService()).toBe(KEYCHAIN_SERVICE_SANDBOX);
  });

  it('round-trips a token under the mapped account key (Chapter 4.2)', async () => {
    await setToken('john_doe', 'npm_abc');
    expect(store.get(`${KEYCHAIN_SERVICE_SANDBOX}:john_doe_npm_token`)).toBe('npm_abc');
    expect(await getToken('john_doe')).toBe('npm_abc');
  });

  it('round-trips a TOTP secret', async () => {
    await setTotpSecret('john_doe', 'JBSWY3DPEHPK3PXP');
    expect(await getTotpSecret('john_doe')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('keeps profiles isolated by username', async () => {
    await setToken('alice', 'npm_alice');
    await setToken('bob', 'npm_bob');
    expect(await getToken('alice')).toBe('npm_alice');
    expect(await getToken('bob')).toBe('npm_bob');
  });

  it('deletes both token and secret for a profile', async () => {
    await setToken('alice', 'npm_alice');
    await setTotpSecret('alice', 'SECRET');
    await deleteProfile('alice');
    expect(await getToken('alice')).toBeNull();
    expect(await getTotpSecret('alice')).toBeNull();
  });

  it('resets back to the production service name', () => {
    resetService();
    expect(activeService()).toBe('pnpm-pub');
  });
});
