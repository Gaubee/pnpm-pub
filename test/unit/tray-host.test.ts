/**
 * TrayHost behavior tests (Chapter 6.4).
 *
 * Drives the KeepOnTop / blur-auto-hide / pending-flash state machine with
 * in-memory fakes mirroring the real opentray API (OpentrayTray / OpentrayWindow)
 * and asserts each spec rule:
 *   - tray click shows the window
 *   - blur hides the window UNLESS a pending event is keeping it on top
 *   - a pending event pins (keepOnTop + visible) and releases when resolved
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DaemonStore } from '../../src/daemon/store.js';
import { TrayHost } from '../../src/daemon/tray-host.js';
import type { OpentrayTray, OpentrayWindow } from '../../src/daemon/tray-host.js';
import { setHomeOverride } from '../../src/shared/paths.js';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

/** Fake WebviewWindowHandle: tracks visibility + keepOnTop + blur handler. */
function makeWindow(): OpentrayWindow & {
  visible: boolean;
  keepOnTop: boolean;
  blurHandler?: () => void;
} {
  const s = { visible: false, keepOnTop: false, blur: undefined as (() => void) | undefined };
  return {
    visible: false,
    keepOnTop: false,
    async show() {
      s.visible = true;
      this.visible = true;
    },
    async hide() {
      s.visible = false;
      this.visible = false;
    },
    async setStyle(style: { keepOnTop?: boolean }) {
      if (style.keepOnTop !== undefined) {
        s.keepOnTop = style.keepOnTop;
        this.keepOnTop = style.keepOnTop;
      }
    },
    listen(_event: string, handler: () => void) {
      s.blur = handler;
      this.blurHandler = handler;
      return () => {
        s.blur = undefined;
      };
    },
    async destroy() {},
    blurHandler: undefined,
  };
}

/** Fake TrayHandle: records title (for flash) and menu-click subscribers. */
function makeTray(): OpentrayTray & { title: string; fireClick(itemId?: number): void } {
  const s = { title: 'pnpm-pub', click: undefined as ((e: { itemId?: number }) => void) | undefined };
  return {
    title: 'pnpm-pub',
    onMenuClick(handler) {
      s.click = handler;
      return () => {
        s.click = undefined;
      };
    },
    async setTitle(t: string) {
      s.title = t;
      this.title = t;
    },
    async setTooltip() {},
    async destroy() {},
    fireClick(itemId = 1) {
      s.click?.({ itemId });
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
  it('shows the window on tray menu click', async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, { title: 'pnpm-pub', openItemId: 1 });
    tray.fireClick(1); // simulate the primaryEvent menu click
    expect(window.visible).toBe(true);
    expect(host.getVisibility()).toBe('shown');
    await host.destroy();
  });

  it('hides the window on blur when nothing is pending', async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: 'pnpm-pub' });
    host.show();
    expect(window.visible).toBe(true);
    window.blurHandler?.(); // simulate focus loss
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe('hidden');
    await host.destroy();
  });

  it('keeps the window on top and ignores blur while an event is pending', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: 'pnpm-pub' });

    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    // pin() sequences show()→setStyle({keepOnTop}); let the microtask chain flush.
    await new Promise((r) => setTimeout(r, 0));
    // Pending event should force keepOnTop + visible.
    expect(host.getVisibility()).toBe('pinned');
    expect(window.keepOnTop).toBe(true);
    expect(window.visible).toBe(true);

    // Blur must NOT hide while pinned.
    window.blurHandler?.();
    expect(window.visible).toBe(true);

    // Resolving releases the pin and hides again.
    store.resolveEvent(evt.id, 'success', 'done');
    expect(host.getVisibility()).toBe('hidden');
    expect(window.keepOnTop).toBe(false);
    expect(window.visible).toBe(false);
    await host.destroy();
  });

  it('swaps to the badged icon while pending and back to base on release (no title change)', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const tray = makeTray();
    let icon = 'base.png';
    const host = new TrayHost(store, tray, makeWindow(), {
      title: 'pnpm-pub',
      baseIcon: 'base.png',
      pendingIcon: 'pending.png',
      setIcon: (p) => {
        icon = p;
      },
    });

    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    await new Promise((r) => setTimeout(r, 10));
    // Pending swaps to the badged icon; the title is NEVER mutated.
    expect(icon).toBe('pending.png');
    expect(tray.title).toBe('pnpm-pub');
    // Stable — no flicker back to base while still pending.
    await new Promise((r) => setTimeout(r, 50));
    expect(icon).toBe('pending.png');

    store.resolveEvent(evt.id, 'success', 'done');
    await new Promise((r) => setTimeout(r, 10));
    expect(icon).toBe('base.png'); // restored to base icon
    await host.destroy();
  });

  it('logs non-Error opentray command rejections without erasing the source text', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const window = makeWindow();
    const lines: string[] = [];
    window.show = async () => {
      throw 'broker offline';
    };
    const host = new TrayHost(store, makeTray(), window, {
      title: 'pnpm-pub',
      log: (line) => lines.push(line),
    });

    host.show();
    store.createEvent({ kind: 'publish', profile: 'alice' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toContain('[tray] show failed: broker offline');
    expect(lines).toContain('[tray] show failed during pin: broker offline');
    await host.destroy();
  });
});
