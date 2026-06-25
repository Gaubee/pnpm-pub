/**
 * Daemon store tests — config persistence, events, credential pool isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { DaemonStore } from '../../src/daemon/store.js';
import { setHomeOverride } from '../../src/shared/paths.js';
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
    await store.removeProfile('alice');
    expect(store.getProfiles()).toEqual([]);
    expect(store.getCredentials('alice')).toBeUndefined();
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
});

describe('DaemonStore risk-boundary state machine (Chapter 5.3.2)', () => {
  it('stages a risky workspace WITHOUT persisting it', async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: '/Users/x/Downloads', pinned: false, addedAt: 1 });
    expect(token).toBe('/Users/x/Downloads');
    // Nothing written yet.
    expect(store.getWorkspaces()).toEqual([]);
    expect(store.getStagedRiskyWorkspaces().map((w) => w.path)).toContain('/Users/x/Downloads');
  });

  it('persists only after explicit confirmation', async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: '/risky', pinned: false, addedAt: 2 });
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
});

