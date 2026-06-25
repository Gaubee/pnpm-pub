/**
 * TrayHost behavior tests (Chapter 6.4).
 *
 * Drives the KeepOnTop / blur-auto-hide / pending-flash state machine with
 * in-memory fakes (no opentray) and asserts each spec rule:
 *   - tray click shows the window
 *   - blur hides the window UNLESS a pending event is keeping it on top
 *   - a pending event pins (keepOnTop + visible) and releases when resolved
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DaemonStore } from '../../src/daemon/store.js';
import { TrayHost } from '../../src/daemon/tray-host.js';
import type { TrayHandleLike, TraySurfaceLike } from '../../src/daemon/tray-host.js';
import { setHomeOverride } from '../../src/shared/paths.js';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

function makeSurface(): TraySurfaceLike & { visible: boolean; keepOnTop: boolean; blurHandler?: () => void } {
  const state = { visible: false, keepOnTop: false, blurHandler: undefined as (() => void) | undefined };
  return {
    visible: false,
    keepOnTop: false,
    show() {
      state.visible = true;
      this.visible = true;
    },
    hide() {
      state.visible = false;
      this.visible = false;
    },
    setKeepOnTop(on) {
      state.keepOnTop = on;
      this.keepOnTop = on;
    },
    onFocusLoss(handler) {
      state.blurHandler = handler;
      this.blurHandler = handler;
      return () => {
        state.blurHandler = undefined;
      };
    },
  };
}

function makeHandle(): TrayHandleLike & { title: string } {
  const state = { title: 'pnpm-pub' };
  return {
    title: 'pnpm-pub',
    onTrayClick() {
      return () => {};
    },
    async setIcon() {},
    async setTitle(t: string) {
      state.title = t;
      this.title = t;
    },
  };
}

const sandbox = path.join(os.tmpdir(), `pnpm-pub-tray-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

describe('TrayHost state machine (Chapter 6.4)', () => {
  it('shows the window on tray click', async () => {
    const store = new DaemonStore();
    await store.load();
    const surface = makeSurface();
    const host = new TrayHost(store, makeHandle(), surface, { url: 'http://x' });
    host.show();
    expect(surface.visible).toBe(true);
    expect(host.getState()).toBe('shown');
    await host.destroy();
  });

  it('hides the window on blur when nothing is pending', async () => {
    const store = new DaemonStore();
    await store.load();
    const surface = makeSurface();
    const host = new TrayHost(store, makeHandle(), surface, { url: 'http://x' });
    host.show();
    expect(surface.visible).toBe(true);
    surface.blurHandler?.(); // simulate focus loss
    expect(surface.visible).toBe(false);
    expect(host.getState()).toBe('hidden');
    await host.destroy();
  });

  it('keeps the window on top and ignores blur while an event is pending', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const surface = makeSurface();
    const host = new TrayHost(store, makeHandle(), surface, { url: 'http://x' });

    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    // Pending event should force keepOnTop + visible.
    expect(host.getState()).toBe('pinned');
    expect(surface.keepOnTop).toBe(true);
    expect(surface.visible).toBe(true);

    // Blur must NOT hide while pinned.
    surface.blurHandler?.();
    expect(surface.visible).toBe(true);

    // Resolving releases the pin and hides again.
    store.resolveEvent(evt.id, 'success', 'done');
    expect(host.getState()).toBe('hidden');
    expect(surface.keepOnTop).toBe(false);
    expect(surface.visible).toBe(false);
    await host.destroy();
  });

  it('flashes the tray title while pending and stops on release', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const handle = makeHandle();
    const host = new TrayHost(store, handle, makeSurface(), { url: 'http://x', title: 'pnpm-pub' });

    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    // Advance the flash timer a couple of ticks.
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 650));
    expect(handle.title).toBe('● pending');
    await new Promise((r) => setTimeout(r, 650));
    expect(handle.title).toBe('pnpm-pub');

    store.resolveEvent(evt.id, 'success', 'done');
    await new Promise((r) => setTimeout(r, 10));
    expect(handle.title).toBe('pnpm-pub'); // restored, no longer flashing
    await host.destroy();
  });
});
