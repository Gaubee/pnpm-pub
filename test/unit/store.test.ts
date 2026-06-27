/**
 * Daemon store tests — config persistence, events, credential pool isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { DaemonStore } from '../../src/daemon/store.js';
import { appDir, profilesPath, setHomeOverride, workspacesPath } from '../../src/shared/paths.js';
import { promises as fsp } from 'node:fs';

const sandbox = path.join(os.tmpdir(), `pnpm-pub-test-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(async () => {
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe('DaemonStore profiles (Chapter 4.1)', () => {
  it('starts empty and persists upserts', async () => {
    const store = new DaemonStore();
    await store.load();
    expect(store.getProfiles()).toEqual([]);
    await store.upsertProfile({ username: 'alice' });
    const reloaded = new DaemonStore();
    await reloaded.load();
    expect(reloaded.getProfiles().map((p) => p.username)).toEqual(['alice']);
    expect(reloaded.getDefault()).toBe('alice');
  });

  it('emits a profiles event on change', async () => {
    const store = new DaemonStore();
    await store.load();
    const seen: string[] = [];
    store.on('profiles', (msg) => seen.push(msg.type));
    await store.upsertProfile({ username: 'bob' });
    expect(seen).toContain('profiles');
  });

  it('removes a profile and clears its credentials', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    store.setCredentials('alice', { token: 't', totpSecret: 's' });
    await expect(store.removeProfile('alice')).resolves.toBe(true);
    expect(store.getProfiles()).toEqual([]);
    expect(store.getCredentials('alice')).toBeUndefined();
  });

  it('Scenario: Given an unknown profile, When removing it, Then profile truth is unchanged', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const seen: string[] = [];
    store.on('profiles', (msg) => seen.push(msg.type));

    await expect(store.removeProfile('ghost')).resolves.toBe(false);

    expect(store.getProfiles().map((profile) => profile.username)).toEqual(['alice']);
    expect(store.getDefault()).toBe('alice');
    expect(seen).toEqual([]);
  });

  it('Scenario: Given an unknown profile, When selecting default, Then profile truth is unchanged', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });

    await expect(store.setDefault('ghost')).resolves.toBe(false);

    expect(store.getDefault()).toBe('alice');
    const reloaded = new DaemonStore();
    await reloaded.load();
    expect(reloaded.getDefault()).toBe('alice');
  });

  it('Scenario: Given malformed profiles.json, When loading, Then profile truth falls back to empty config', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({ default: 'ghost', profiles: [{ username: 42 }] }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe('');
  });

  it('Scenario: Given profiles.json with an orphan default, When loading, Then default points at a profile source', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({
        default: 'ghost',
        profiles: [{ username: 'alice' }, { username: 'work' }],
      }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles().map((profile) => profile.username)).toEqual(['alice', 'work']);
    expect(store.getDefault()).toBe('alice');
  });

  it('Scenario: Given profiles.json with an empty username, When loading, Then profile truth falls back to empty config', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({ default: '', profiles: [{ username: '' }] }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe('');
  });

  it('Scenario: Given profiles.json with duplicate usernames, When loading, Then profile truth falls back to empty config', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({
        default: 'alice',
        profiles: [{ username: 'alice' }, { username: 'alice', registry: 'https://registry.example/' }],
      }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe('');
  });
});

describe('DaemonStore events (Chapter 6.2)', () => {
  it('creates pending events in newest-first order', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const a = store.createEvent({ kind: 'publish', profile: 'alice' });
    const b = store.createEvent({ kind: 'publish', profile: 'alice' });
    const list = store.getEvents();
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
    expect(list.every((e) => e.status === 'pending')).toBe(true);
  });

  it('resolves events and records the result', async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    store.resolveEvent(evt.id, 'success', 'published @scope/x@1.0.0');
    const resolved = store.getEvent(evt.id);
    expect(resolved?.status).toBe('success');
    expect(resolved?.result).toBe('published @scope/x@1.0.0');
    expect(resolved?.resolvedAt).toBeTypeOf('number');
  });

  it('Scenario: Given clock drift recovery metadata, When resolving, Then only the named resolution fact is recorded', async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });

    store.resolveEvent(evt.id, 'success', 'published @scope/x@1.0.0', { clockDriftRecovered: true });

    const resolved = store.getEvent(evt.id);
    expect(resolved?.status).toBe('success');
    expect(resolved?.clockDriftRecovered).toBe(true);
    expect(resolved?.createdAt).toBe(evt.createdAt);
  });
});

describe('DaemonStore risk-boundary state machine (Chapter 5.3.2)', () => {
  it('Scenario: Given a risky workspace, When staged, Then the confirmation token is not the path', async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: '/Users/x/Downloads', pinned: false, addedAt: 1 });
    expect(token).not.toBe('/Users/x/Downloads');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing written yet.
    expect(store.getWorkspaces()).toEqual([]);
    expect(store.getStagedRiskyWorkspaces().map((w) => w.path)).toContain('/Users/x/Downloads');
  });

  it('Scenario: Given a staged risky workspace, When confirmed by opaque token, Then it persists once', async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: '/risky', pinned: false, addedAt: 2 });
    await expect(store.confirmRiskyWorkspace('/risky')).resolves.toBe(false);
    expect(store.getWorkspaces()).toEqual([]);
    const confirmed = await store.confirmRiskyWorkspace(token);
    expect(confirmed).toBe(true);
    expect(store.getWorkspaces().map((w) => w.path)).toContain('/risky');
    // Token consumed — a second confirm fails.
    const again = await store.confirmRiskyWorkspace(token);
    expect(again).toBe(false);
  });

  it('cancel discards a staged risky workspace without persisting', async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: '/risky2', pinned: false, addedAt: 3 });
    store.cancelRiskyWorkspace(token);
    expect(store.getStagedRiskyWorkspaces()).toEqual([]);
    expect(store.getWorkspaces()).toEqual([]);
  });

  it('Scenario: Given runtime workspace input with extra projection fields, When stored, Then only workspace ontology fields persist', async () => {
    const store = new DaemonStore();
    await store.load();
    const root = path.join(sandbox, 'workspace');
    const firstEntry = { path: root, pinned: false, addedAt: 1, displayName: 'Workspace' };
    const updatedEntry = { path: root, pinned: true, addedAt: 2, displayName: 'Renamed workspace' };

    await store.addWorkspace(firstEntry);
    await store.addWorkspace(updatedEntry);

    const [workspace] = store.getWorkspaces();
    expect(workspace).toEqual({ path: root, pinned: true, addedAt: 2 });
    expect('displayName' in workspace!).toBe(false);
  });

  it('Scenario: Given malformed workspaces.json, When loading, Then workspace truth falls back to empty config', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: '/proj', pinned: 'yes', addedAt: 1 }] }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it('Scenario: Given workspaces.json with a relative path, When loading, Then workspace truth falls back to empty config', async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: 'packages/widget', pinned: false, addedAt: 1 }] }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it('Scenario: Given workspaces.json with duplicate root paths, When loading, Then workspace truth falls back to empty config', async () => {
    const root = path.join(sandbox, 'repo');
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({
        paths: [
          { path: root, pinned: false, addedAt: 1 },
          { path: root, pinned: true, addedAt: 2 },
        ],
      }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it('Scenario: Given workspaces.json with an invalid timestamp, When loading, Then workspace truth falls back to empty config', async () => {
    const root = path.join(sandbox, 'repo');
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: root, pinned: false, addedAt: -1 }] }),
      'utf8',
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });
});
