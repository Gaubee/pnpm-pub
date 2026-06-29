/**
 * Renewal flow test (Chapter 6.2.4).
 *
 * Ensures `/api/renew` reuses the stored TOTP secret and does not blank it out
 * when the UI submits only a password or a manual token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { DaemonStore } from '../../src/daemon/store.js';
import { PublishScheduler } from '../../src/daemon/scheduler.js';
import { WebServer } from '../../src/daemon/web-server.js';
import { setHomeOverride } from '../../src/shared/paths.js';
import { exportBundle, importBundle } from '../../src/daemon/crypto.js';
import type { BackupBundle, Profile, WorkspaceEntry, WsServerMessage } from '../../src/shared/index.js';

const mocks = vi.hoisted(() => ({
  applyTokenMock: vi.fn(),
  lookupNpmProfileIdentityMock: vi.fn(),
  setTokenMock: vi.fn(),
  setTotpSecretMock: vi.fn(),
  getTokenMock: vi.fn(),
  getTotpSecretMock: vi.fn(),
  deleteTokenMock: vi.fn(),
  deleteTotpSecretMock: vi.fn(),
  deleteProfileMock: vi.fn(),
}));

vi.mock('../../src/daemon/npm-api.js', () => ({
  applyToken: mocks.applyTokenMock,
  publishPackage: vi.fn(),
  configureOidc: vi.fn(),
  isExpiredToken: vi.fn(),
}));

vi.mock('../../src/daemon/avatar.js', () => ({
  lookupNpmProfileIdentity: mocks.lookupNpmProfileIdentityMock,
}));

vi.mock('../../src/daemon/keychain.js', () => ({
  setToken: mocks.setTokenMock,
  setTotpSecret: mocks.setTotpSecretMock,
  getToken: mocks.getTokenMock,
  getTotpSecret: mocks.getTotpSecretMock,
  deleteToken: mocks.deleteTokenMock,
  deleteTotpSecret: mocks.deleteTotpSecretMock,
  deleteProfile: mocks.deleteProfileMock,
}));

const sandbox = path.join(os.tmpdir(), `pnpm-pub-renew-${process.pid}-${Date.now()}`);

type RenewWsEvidenceMessage = Extract<WsServerMessage, { type: 'profiles' | 'workspaces' }>;
type RenewWsToastMessage = Extract<WsServerMessage, { type: 'toast' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProfile(value: unknown): value is Profile {
  return isRecord(value) && typeof value.username === 'string';
}

function isWorkspaceEntry(value: unknown): value is WorkspaceEntry {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.pinned === 'boolean' &&
    typeof value.addedAt === 'number'
  );
}

function isBackupBundle(value: unknown): value is BackupBundle {
  return (
    isRecord(value) &&
    Array.isArray(value.profiles) &&
    value.profiles.every((profile) => typeof profile === 'string') &&
    typeof value.salt === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

function parseExportResponse(value: unknown): { ok: true; bundle: BackupBundle; skipped?: string[] } | null {
  if (!isRecord(value) || value.ok !== true || !isBackupBundle(value.bundle)) return null;
  if (value.skipped !== undefined) {
    if (!Array.isArray(value.skipped) || !value.skipped.every((entry) => typeof entry === 'string')) return null;
    return { ok: true, bundle: value.bundle, skipped: value.skipped };
  }
  return { ok: true, bundle: value.bundle };
}

function parseRenewWsEvidenceMessage(data: string): RenewWsEvidenceMessage | null {
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Invalid WebSocket server message');
  }
  if (
    parsed.type === 'profiles' &&
    typeof parsed.default === 'string' &&
    Array.isArray(parsed.profiles) &&
    parsed.profiles.every(isProfile)
  ) {
    return { type: 'profiles', default: parsed.default, profiles: parsed.profiles };
  }
  if (parsed.type === 'workspaces' && Array.isArray(parsed.workspaces) && parsed.workspaces.every(isWorkspaceEntry)) {
    return { type: 'workspaces', workspaces: parsed.workspaces };
  }
  return null;
}

function parseRenewWsToastMessage(data: string): RenewWsToastMessage | null {
  const parsed: unknown = JSON.parse(data);
  if (
    isRecord(parsed) &&
    parsed.type === 'toast' &&
    (parsed.level === 'info' || parsed.level === 'success' || parsed.level === 'error' || parsed.level === 'warning') &&
    typeof parsed.message === 'string'
  ) {
    return { type: 'toast', level: parsed.level, message: parsed.message };
  }
  return null;
}

describe('renew flow keeps the stored secret', () => {
  let store: DaemonStore;
  let web: WebServer | null = null;
  let port = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await fsp.rm(sandbox, { recursive: true, force: true });
    await fsp.mkdir(sandbox, { recursive: true });
    setHomeOverride(sandbox);
    mocks.getTokenMock.mockResolvedValue('old-token');
    mocks.getTotpSecretMock.mockResolvedValue('SECRET');
    mocks.lookupNpmProfileIdentityMock.mockImplementation((username: string, registry: string) =>
      Promise.resolve({
        username,
        registry: registry.replace(/\/$/, ''),
        avatarUrl: null,
        source: 'none',
      }),
    );

    store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice', registry: 'https://registry.npmjs.org/' });
    store.setCredentials('alice', { token: 'old-token', totpSecret: 'SECRET' });

    web = new WebServer({
      store,
      scheduler: new PublishScheduler(store),
      webToken: 'webtoken',
      webuiDir: sandbox,
    });
    port = await web.start(0);
  });

  afterEach(async () => {
    await web?.stop();
    web = null;
    setHomeOverride(null);
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it('uses the stored TOTP secret and preserves it on manual-token renew', async () => {
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: 'npm_manual_renewed' });
    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'ignored',
        manualToken: 'npm_manual_renewed',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).not.toHaveBeenCalled();
    expect(mocks.setTokenMock).toHaveBeenCalledWith('alice', 'npm_manual_renewed');
    expect(mocks.setTotpSecretMock).not.toHaveBeenCalled();
    expect(store.getCredentials('alice')).toEqual({
      token: 'npm_manual_renewed',
      totpSecret: 'SECRET',
    });
  });

  it('preserves non-Error add-profile persistence failure text', async () => {
    vi.spyOn(store, 'upsertProfile').mockRejectedValueOnce('profile disk offline');
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);
    mocks.deleteProfileMock.mockResolvedValue(undefined);

    const res = await fetch(`http://127.0.0.1:${port}/api/add-profile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'bob',
        password: 'ignored',
        totpSecret: 'BOBSECRET',
        manualToken: 'npm_manual_bob',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to persist profile: profile disk offline',
    });
    expect(mocks.deleteProfileMock).toHaveBeenCalledWith('bob');
    expect(store.getCredentials('bob')).toBeUndefined();
  });

  it('resolves npm profile identity through a token-guarded API', async () => {
    mocks.lookupNpmProfileIdentityMock.mockResolvedValueOnce({
      username: 'bob',
      registry: 'https://registry.npmjs.org',
      avatarUrl: 'https://gravatar.com/avatar/bob?s=128&d=404',
      source: 'maintainer-gravatar',
    });

    const res = await fetch(
      `http://127.0.0.1:${port}/api/npm-profile?username=bob&registry=${encodeURIComponent('https://registry.npmjs.org/')}`,
      {
        headers: {
          authorization: 'Bearer webtoken',
        },
      },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      profile: {
        username: 'bob',
        registry: 'https://registry.npmjs.org',
        avatarUrl: 'https://gravatar.com/avatar/bob?s=128&d=404',
        source: 'maintainer-gravatar',
      },
    });
    expect(mocks.lookupNpmProfileIdentityMock).toHaveBeenCalledWith('bob', 'https://registry.npmjs.org/');
  });

  it('persists a resolved avatar URL when adding a profile', async () => {
    mocks.lookupNpmProfileIdentityMock.mockResolvedValueOnce({
      username: 'bob',
      registry: 'https://registry.npmjs.org',
      avatarUrl: 'https://gravatar.com/avatar/bob?s=128&d=404',
      source: 'maintainer-gravatar',
    });
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);

    const res = await fetch(`http://127.0.0.1:${port}/api/add-profile`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'bob',
        password: 'ignored',
        totpSecret: 'BOBSECRET',
        manualToken: 'npm_manual_bob',
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(store.getProfile('bob')).toEqual({
      username: 'bob',
      registry: 'https://registry.npmjs.org/',
      avatarUrl: 'https://gravatar.com/avatar/bob?s=128&d=404',
    });
  });

  it('restores the previous token and secret when persistence fails', async () => {
    vi.spyOn(store, 'upsertProfile').mockRejectedValueOnce('persist failed');
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);

    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'ignored',
        manualToken: 'npm_manual_renewed',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Failed to renew profile: persist failed');

    expect(mocks.setTokenMock).toHaveBeenNthCalledWith(1, 'alice', 'npm_manual_renewed');
    expect(mocks.setTokenMock).toHaveBeenNthCalledWith(2, 'alice', 'old-token');
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith('alice', 'SECRET');
    expect(mocks.deleteTokenMock).not.toHaveBeenCalled();
    expect(mocks.deleteTotpSecretMock).not.toHaveBeenCalled();
    expect(store.getCredentials('alice')).toEqual({
      token: 'old-token',
      totpSecret: 'SECRET',
    });
  });

  it('accepts a manual-token renew with a supplied TOTP secret when none is loaded', async () => {
    store.deleteCredentials('alice');
    mocks.getTotpSecretMock.mockResolvedValue(null);

    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'ignored',
        manualToken: 'npm_manual_renewed',
        totpSecret: 'NEWSECRET',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).not.toHaveBeenCalled();
    expect(mocks.setTokenMock).toHaveBeenCalledWith('alice', 'npm_manual_renewed');
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith('alice', 'NEWSECRET');
    expect(store.getCredentials('alice')).toEqual({
      token: 'npm_manual_renewed',
      totpSecret: 'NEWSECRET',
    });
  });

  it('uses a supplied TOTP secret for silent renew when none is loaded', async () => {
    store.deleteCredentials('alice');
    mocks.getTotpSecretMock.mockResolvedValue(null);
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: 'npm_silent_renewed' });

    const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        username: 'alice',
        password: 'fresh-password',
        totpSecret: 'NEWSECRET',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).toHaveBeenCalledWith({
      registry: 'https://registry.npmjs.org/',
      username: 'alice',
      password: 'fresh-password',
      totpSecret: 'NEWSECRET',
    });
    expect(mocks.setTokenMock).toHaveBeenCalledWith('alice', 'npm_silent_renewed');
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith('alice', 'NEWSECRET');
    expect(store.getCredentials('alice')).toEqual({
      token: 'npm_silent_renewed',
      totpSecret: 'NEWSECRET',
    });
  });

  it('burns the raw JSON request buffer after parsing a password-bearing renew request', async () => {
    store.deleteCredentials('alice');
    mocks.getTotpSecretMock.mockResolvedValue(null);
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: 'npm_silent_renewed' });
    const fillSpy = vi.spyOn(Buffer.prototype, 'fill');

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/renew`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer webtoken',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'fresh-password',
          totpSecret: 'NEWSECRET',
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
    }
  });

  it('exports profile credentials from keychain when the memory pool is empty', async () => {
    store.deleteCredentials('alice');
    mocks.getTokenMock.mockResolvedValue('keychain-token');
    mocks.getTotpSecretMock.mockResolvedValue('KEYCHAINSECRET');

    const res = await fetch(`http://127.0.0.1:${port}/api/export`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({ password: 'backup-password' }),
    });

    const responseBody: unknown = await res.json();
    const json = parseExportResponse(responseBody);
    expect(json).not.toBeNull();
    if (!json) throw new Error('Invalid export response');
    expect(json.ok).toBe(true);
    expect(json.skipped).toBeUndefined();
    const decoded = importBundle(json.bundle, 'backup-password');
    expect(decoded?.alice).toEqual({ token: 'keychain-token', totp: 'KEYCHAINSECRET' });
    expect(store.getCredentials('alice')).toEqual({
      token: 'keychain-token',
      totpSecret: 'KEYCHAINSECRET',
    });
  });

  it('serves static assets with known MIME types and binary fallback for unknown extensions', async () => {
    await fsp.writeFile(path.join(sandbox, 'style.css'), 'body { color: red; }', 'utf8');
    await fsp.writeFile(path.join(sandbox, 'artifact.bin'), 'opaque', 'utf8');

    const css = await fetch(`http://127.0.0.1:${port}/style.css`);
    const bin = await fetch(`http://127.0.0.1:${port}/artifact.bin`);

    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    await expect(css.text()).resolves.toBe('body { color: red; }');
    expect(bin.status).toBe(200);
    expect(bin.headers.get('content-type')).toBe('application/octet-stream');
    await expect(bin.text()).resolves.toBe('opaque');
  });

  it('deletes a profile from a DELETE request body', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/profiles`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({ username: 'alice' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.deleteProfileMock).toHaveBeenCalledWith('alice');
  });

  it('reports a missing profile from DELETE /api/profiles without mutating profile truth', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/profiles`, {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({ username: 'ghost' }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Profile ghost not found.' });
    expect(mocks.deleteProfileMock).not.toHaveBeenCalledWith('ghost');
    expect(store.getProfiles().map((profile) => profile.username)).toEqual(['alice']);
  });

  it('rejects an invalid import bundle payload', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        bundle: { profiles: ['alice'], salt: 'bad', iv: 'bad' },
        password: 'backup-password',
        usernames: ['alice'],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Invalid backup bundle.',
    });
  });

  it('rolls back imported keychain credentials when profile persistence fails', async () => {
    const bundle = exportBundle(
      {
        bob: { token: 'imported-token', totp: 'IMPORTEDSECRET' },
      },
      'backup-password',
    );
    vi.spyOn(store, 'upsertProfile').mockRejectedValueOnce('profile disk offline');

    const res = await fetch(`http://127.0.0.1:${port}/api/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer webtoken',
      },
      body: JSON.stringify({
        bundle,
        password: 'backup-password',
        usernames: ['bob'],
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to import profile bob: profile disk offline',
    });
    expect(mocks.setTokenMock).toHaveBeenCalledWith('bob', 'imported-token');
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith('bob', 'IMPORTEDSECRET');
    expect(mocks.deleteTokenMock).toHaveBeenCalledWith('bob');
    expect(mocks.deleteTotpSecretMock).toHaveBeenCalledWith('bob');
    expect(store.getCredentials('bob')).toBeUndefined();
    expect(store.getProfile('bob')).toBeUndefined();
  });

  it('re-broadcasts the workspace snapshot after a profile switch', async () => {
    await store.upsertProfile({ username: 'bob' });
    await store.addWorkspace({ path: '/proj/a', pinned: false, addedAt: 1 });

    const wsUrl = `ws://127.0.0.1:${port}/?token=webtoken`;
    const ws = new WebSocket(wsUrl);
    const messages: RenewWsEvidenceMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', webToken: 'webtoken' }));
        ws.send(JSON.stringify({ type: 'select-profile', username: 'bob' }));
      };
      ws.onerror = () => reject(new Error('ws error'));
      ws.onmessage = (ev) => {
        const msg = parseRenewWsEvidenceMessage(String(ev.data));
        if (!msg) return;
        messages.push(msg);
        if (messages.filter((m) => m.type === 'workspaces').length >= 2) {
          resolve();
        }
      };
      setTimeout(() => reject(new Error('timed out waiting for workspace rebroadcast')), 3000);
    });

    const workspaces = messages.filter((m) => m.type === 'workspaces');
    expect(workspaces).toHaveLength(2);
    expect(workspaces[1]?.workspaces).toEqual([{ path: '/proj/a', pinned: false, addedAt: 1 }]);
    expect(messages.some((m) => m.type === 'profiles' && m.default === 'bob')).toBe(true);
    ws.close();
  });

  it('rejects malformed authenticated WebSocket actions before creating events', async () => {
    const wsUrl = `ws://127.0.0.1:${port}/?token=webtoken`;
    const ws = new WebSocket(wsUrl);
    const toasts: RenewWsToastMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'create-event', kind: 'not-a-real-kind', payload: { name: 'pkg' } }));
      };
      ws.onerror = () => reject(new Error('ws error'));
      ws.onmessage = (ev) => {
        const msg = parseRenewWsToastMessage(String(ev.data));
        if (!msg) return;
        toasts.push(msg);
        if (msg.level === 'error' && msg.message === 'Invalid WebSocket message.') {
          resolve();
        }
      };
      setTimeout(() => reject(new Error('timed out waiting for invalid-message toast')), 3000);
    });

    expect(toasts).toContainEqual({ type: 'toast', level: 'error', message: 'Invalid WebSocket message.' });
    expect(store.getEvents()).toEqual([]);
    ws.close();
  });

  it('rejects backup import/export as WebSocket event actions', async () => {
    const wsUrl = `ws://127.0.0.1:${port}/?token=webtoken`;
    const ws = new WebSocket(wsUrl);
    const toasts: RenewWsToastMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'create-event', kind: 'export', payload: {} }));
      };
      ws.onerror = () => reject(new Error('ws error'));
      ws.onmessage = (ev) => {
        const msg = parseRenewWsToastMessage(String(ev.data));
        if (!msg) return;
        toasts.push(msg);
        if (msg.level === 'error' && msg.message === 'Invalid WebSocket message.') {
          resolve();
        }
      };
      setTimeout(() => reject(new Error('timed out waiting for backup-kind rejection')), 3000);
    });

    expect(toasts).toContainEqual({ type: 'toast', level: 'error', message: 'Invalid WebSocket message.' });
    expect(store.getEvents()).toEqual([]);
    ws.close();
  });

  it('reports missing pending events for authenticated WebSocket rejects', async () => {
    const wsUrl = `ws://127.0.0.1:${port}/?token=webtoken`;
    const ws = new WebSocket(wsUrl);
    const toasts: RenewWsToastMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'reject-event', id: 'missing-task' }));
      };
      ws.onerror = () => reject(new Error('ws error'));
      ws.onmessage = (ev) => {
        const msg = parseRenewWsToastMessage(String(ev.data));
        if (!msg) return;
        toasts.push(msg);
        if (msg.level === 'error' && msg.message === 'No such pending event.') {
          resolve();
        }
      };
      setTimeout(() => reject(new Error('timed out waiting for missing-reject toast')), 3000);
    });

    expect(toasts).toContainEqual({ type: 'toast', level: 'error', message: 'No such pending event.' });
    expect(store.getEvents()).toEqual([]);
    ws.close();
  });
});
