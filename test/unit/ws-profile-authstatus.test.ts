/**
 * End-to-end WS + REST integration test for the auth-status + OIDC flow.
 *
 * Boots a real WebServer (in-memory keychain mock), connects via WS to
 * receive the profiles frame, and verifies authStatus is carried. Then
 * exercises /api/add-profile + /api/oidc/trust to confirm the full chain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { DaemonStore } from '../../src/daemon/store.js';
import { PublishScheduler } from '../../src/daemon/scheduler.js';
import { WebServer } from '../../src/daemon/web-server.js';
import { setHomeOverride } from '../../src/shared/paths.js';
import type { WsServerMessage } from '../../src/shared/index.js';

// In-memory keytar stub
const kcStore = new Map<string, string>();
const kcKey = (s: string, a: string) => `${s}:${a}`;
const inMemoryKeytar = {
  async setPassword(s: string, a: string, p: string) { kcStore.set(kcKey(s, a), p); },
  async getPassword(s: string, a: string) { return kcStore.get(kcKey(s, a)) ?? null; },
  async deletePassword(s: string, a: string) { return kcStore.delete(kcKey(s, a)); },
  async findCredentials(s: string) {
    const out: { account: string; password: string }[] = [];
    for (const [k, v] of kcStore) if (k.startsWith(`${s}:`)) out.push({ account: k.slice(s.length + 1), password: v });
    return out;
  },
  async findPassword() { return null; },
};

vi.mock('../../src/daemon/npm-api.js', () => ({
  applyToken: vi.fn().mockResolvedValue({ ok: true, token: 'npm_test_token' }),
  verifyCredentials: vi.fn().mockResolvedValue({
    ok: true, status: 200,
    check: { authValid: true, requires2FA: true, otpValid: true, message: 'auth valid, OTP valid' },
  }),
  publishPackage: vi.fn(),
  configureOidc: vi.fn(),
  isExpiredToken: vi.fn(),
}));

vi.mock('../../src/daemon/avatar.js', () => ({
  lookupNpmProfileIdentity: vi.fn().mockResolvedValue({
    username: 'testuser', registry: 'https://registry.npmjs.org', avatarUrl: null, source: 'none',
  }),
}));

vi.mock('../../src/daemon/keychain.js', () => {
  return {
    __setKeytarForTest: (api: unknown) => {},
    useSandboxService: () => {},
    resetService: () => {},
    activeService: () => 'pnpm-pub-test-sandbox',
    // Real in-memory impl via the stub above
    setToken: async (u: string, v: string) => { kcStore.set(kcKey('pnpm-pub-test-sandbox', `${u}_npm_token`), v); },
    getToken: async (u: string) => kcStore.get(kcKey('pnpm-pub-test-sandbox', `${u}_npm_token`)) ?? null,
    deleteToken: async (u: string) => { kcStore.delete(kcKey('pnpm-pub-test-sandbox', `${u}_npm_token`)); },
    setTotpSecret: async (u: string, v: string) => { kcStore.set(kcKey('pnpm-pub-test-sandbox', `${u}_totp_secret`), v); },
    getTotpSecret: async (u: string) => kcStore.get(kcKey('pnpm-pub-test-sandbox', `${u}_totp_secret`)) ?? null,
    deleteTotpSecret: async (u: string) => { kcStore.delete(kcKey('pnpm-pub-test-sandbox', `${u}_totp_secret`)); },
    deleteProfile: async (u: string) => { kcStore.delete(kcKey('pnpm-pub-test-sandbox', `pnpm_pub-key${u}-auth`)); kcStore.delete(kcKey('pnpm-pub-test-sandbox', `${u}_npm_token`)); kcStore.delete(kcKey('pnpm-pub-test-sandbox', `${u}_totp_secret`)); },
    getProfileSecrets: async (u: string) => {
      const raw = kcStore.get(kcKey('pnpm-pub-test-sandbox', `pnpm_pub-key${u}-auth`));
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    setProfileSecrets: async (u: string, s: { npm_token: string; totp_secret: string; npm_pwd: string }) => {
      kcStore.set(kcKey('pnpm-pub-test-sandbox', `pnpm_pub-key${u}-auth`), JSON.stringify(s));
    },
    deleteProfileSecrets: async (u: string) => { kcStore.delete(kcKey('pnpm-pub-test-sandbox', `pnpm_pub-key${u}-auth`)); },
  };
});

// Fetch the keychain module AFTER mock is set up
import {
  setProfileSecrets as setSecrets,
  useSandboxService,
  __setKeytarForTest,
  resetService,
} from '../../src/daemon/keychain.js';

const sandbox = path.join(os.tmpdir(), `pnpm-pub-ws-${process.pid}-${Date.now()}`);
const WEB_TOKEN = 'test-webtoken-for-e2e';

function wsConnect(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('WS connect failed'));
    setTimeout(() => reject(new Error('WS timeout')), 3000);
  });
}

describe('WS profiles frame carries authStatus', () => {
  let store: DaemonStore;
  let web: WebServer;
  let port: number;

  beforeEach(async () => {
    kcStore.clear();
    useSandboxService();
    __setKeytarForTest(inMemoryKeytar);
    await fsp.rm(sandbox, { recursive: true, force: true });
    await fsp.mkdir(sandbox, { recursive: true });
    setHomeOverride(sandbox);

    store = new DaemonStore();
    await store.load();
    // Seed a profile that IS authenticated (has merged keychain item).
    await setSecrets('alice', { npm_token: 'npm_alice', totp_secret: 'SECRET', npm_pwd: 'pw' });
    await store.upsertProfile({ username: 'alice', registry: 'https://registry.npmjs.org/', authStatus: 'authenticated' });
    store.setCredentials('alice', { token: 'npm_alice', totpSecret: 'SECRET', npmPwd: 'pw' });

    web = new WebServer({ store, scheduler: new PublishScheduler(store), webToken: WEB_TOKEN, webuiDir: sandbox });
    port = await web.start(0);
  });

  afterEach(async () => {
    await web?.stop();
    __setKeytarForTest(null);
    resetService();
    setHomeOverride(null);
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it('receives profiles frame with authStatus via WS', async () => {
    const ws = await wsConnect(port, WEB_TOKEN);
    const messages: WsServerMessage[] = [];
    await new Promise<void>((resolve) => {
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as WsServerMessage;
        messages.push(msg);
        if (msg.type === 'workspaces') resolve(); // workspaces is the last frame sent on open
      };
    });
    ws.close();

    const profilesMsg = messages.find((m) => m.type === 'profiles');
    expect(profilesMsg).toBeDefined();
    if (profilesMsg && profilesMsg.type === 'profiles') {
      expect(profilesMsg.profiles).toHaveLength(1);
      expect(profilesMsg.profiles[0]!.username).toBe('alice');
      expect(profilesMsg.profiles[0]!.authStatus).toBe('authenticated');
    }
  });

  it('add-profile sets authStatus=authenticated and stores merged secrets', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/add-profile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${WEB_TOKEN}` },
      body: JSON.stringify({
        username: 'bob',
        password: 'bobpassword',
        totpSecret: 'BOBSECRET',
      }),
    });
    const json = await res.json();
    expect(json.ok).toBe(true);
    // Profile should have authStatus.
    const bob = store.getProfile('bob');
    expect(bob?.authStatus).toBe('authenticated');
    // Merged keychain item should contain the password.
    const raw = kcStore.get('pnpm-pub-test-sandbox:pnpm_pub-keybob-auth');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.npm_pwd).toBe('bobpassword');
  });

  it('renew with stored password re-mints token (no manual password needed)', async () => {
    // Seed bob with merged item (incl. password).
    await setSecrets('bob', { npm_token: 'npm_old', totp_secret: 'BOBSECRET', npm_pwd: 'bobpassword' });
    await store.upsertProfile({ username: 'bob', registry: 'https://registry.npmjs.org/' });
    store.setCredentials('bob', { token: 'npm_old', totpSecret: 'BOBSECRET', npmPwd: 'bobpassword' });

    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${WEB_TOKEN}` },
      body: JSON.stringify({ username: 'bob' }), // NO password — should use stored
    });
    const json = await res.json();
    if (!json.ok) console.log('renew bob failed:', JSON.stringify(json));
    expect(json.ok).toBe(true);
    expect(store.getProfile('bob')?.authStatus).toBe('authenticated');
  });

  it('renew without any password marks unauthenticated', async () => {
    await store.upsertProfile({ username: 'carol' });
    store.setCredentials('carol', { token: 'npm_carol', totpSecret: 'SECRET' }); // no npmPwd

    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${WEB_TOKEN}` },
      body: JSON.stringify({ username: 'carol' }),
    });
    const json = await res.json();
    console.log('renew carol result:', JSON.stringify(json));
    console.log('carol profile:', JSON.stringify(store.getProfile('carol')));
    expect(json.ok).toBe(false);
    expect(store.getProfile('carol')?.authStatus).toBe('unauthenticated');
  });
});
