/**
 * Tests for refreshCredentials — the daemon startup pool pre-warm.
 *
 * Verifies the core invariant: it reads ONLY the merged ProfileSecrets item,
 * never the legacy split token/totp items. A profile without a merged item
 * is left out of the pool (treated as unauthenticated) rather than prompting
 * for split items.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// In-memory keytar stub
const store = new Map<string, string>();
const key = (service: string, account: string) => `${service}:${account}`;
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
      if (k.startsWith(`${service}:`)) out.push({ account: k.slice(service.length + 1), password: v });
    }
    return out;
  },
  async findPassword() {
    return null;
  },
};

// We must import AFTER setting up the stub, but ESM imports are hoisted.
// Use dynamic import inside each test to control ordering.
import {
  __setKeytarForTest,
  useSandboxService,
  resetService,
  setProfileSecrets,
  setToken,
  setTotpSecret,
} from '../../src/daemon/keychain.js';
import { refreshCredentials } from '../../src/daemon/index.js';
import type { DaemonStore } from '../../src/daemon/store.js';
import type { Profile } from '../../src/shared/index.js';

function makeStore(profiles: Profile[], defaultUser = ''): DaemonStore {
  // Minimal stub satisfying what refreshCredentials touches.
  const pool = new Map<string, { token: string; totpSecret: string; npmPwd?: string }>();
  return {
    getProfiles: () => profiles,
    getDefault: () => defaultUser,
    clearCredentials: () => pool.clear(),
    getCredentials: (u: string) => pool.get(u),
    setCredentials: (u: string, c: { token: string; totpSecret: string; npmPwd?: string }) => pool.set(u, c),
  } as unknown as DaemonStore;
}

describe('refreshCredentials', () => {
  beforeEach(() => {
    store.clear();
    useSandboxService();
    __setKeytarForTest(inMemoryKeytar);
  });
  afterEach(() => {
    __setKeytarForTest(null);
    resetService();
  });

  it('reads merged item and warms pool with token + totp + password', async () => {
    await setProfileSecrets('alice', { npm_token: 'npm_alice', totp_secret: 'AAA', npm_pwd: 'pw1' });
    const s = makeStore([{ username: 'alice' }], 'alice');
    await refreshCredentials(s);
    const creds = s.getCredentials('alice');
    expect(creds?.token).toBe('npm_alice');
    expect(creds?.totpSecret).toBe('AAA');
    expect(creds?.npmPwd).toBe('pw1');
  });

  it('does NOT read legacy split items (no prompt for them)', async () => {
    // Only legacy split items exist, NO merged item.
    await setToken('bob', 'npm_bob');
    await setTotpSecret('bob', 'BOB_SECRET');
    const s = makeStore([{ username: 'bob' }], 'bob');
    await refreshCredentials(s);
    // Pool should be EMPTY — we deliberately don't read split items.
    expect(s.getCredentials('bob')).toBeUndefined();
  });

  it('skips profiles with no keychain item at all', async () => {
    const s = makeStore([{ username: 'nobody' }], 'nobody');
    await refreshCredentials(s);
    expect(s.getCredentials('nobody')).toBeUndefined();
  });

  it('handles multiple profiles — merged ones warm, others skipped', async () => {
    await setProfileSecrets('alice', { npm_token: 'npm_alice', totp_secret: 'A', npm_pwd: 'pwa' });
    // bob has only legacy split items
    await setToken('bob', 'npm_bob');
    await setTotpSecret('bob', 'B');
    const s = makeStore([{ username: 'alice' }, { username: 'bob' }], 'alice');
    await refreshCredentials(s);
    expect(s.getCredentials('alice')?.token).toBe('npm_alice');
    expect(s.getCredentials('bob')).toBeUndefined();
  });

  it('clears the pool before re-populating', async () => {
    await setProfileSecrets('alice', { npm_token: 'npm_alice', totp_secret: 'A', npm_pwd: 'pwa' });
    const s = makeStore([{ username: 'alice' }], 'alice');
    // Pre-seed with stale data.
    s.setCredentials('alice', { token: 'STALE', totpSecret: 'STALE' });
    s.setCredentials('ghost', { token: 'GHOST', totpSecret: 'GHOST' });
    await refreshCredentials(s);
    expect(s.getCredentials('alice')?.token).toBe('npm_alice');
    expect(s.getCredentials('ghost')).toBeUndefined();
  });
});
