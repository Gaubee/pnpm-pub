/**
 * TrayHost behavior tests (Chapter 6.4).
 *
 * The earlier pin/release/blur/pending-flash state machine has been removed
 * (it trapped the window and rejected events on focus loss). These tests now
 * cover the remaining surface: tray-click toggles the window, show/hide are
 * pure visibility ops, keepOnTop is applied on show, and opentray rejections
 * are logged without crashing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DaemonStore } from '../../src/daemon/store.js';
import { TrayHost } from '../../src/daemon/tray-host.js';
import type { OpentrayTray, OpentrayWindow } from '../../src/daemon/tray-host.js';
import { setHomeOverride } from '../../src/shared/paths.js';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * Fake WebviewWindowHandle: tracks visibility + keepOnTop. Implements only the
 * surface TrayHost drives.
 */
function makeWindow(): OpentrayWindow & { visible: boolean; keepOnTop: boolean } {
  return {
    visible: false,
    keepOnTop: false,
    async show() {
      this.visible = true;
    },
    async hide() {
      this.visible = false;
    },
    async setStyle(style: { keepOnTop?: boolean }) {
      if (style.keepOnTop !== undefined) {
        this.keepOnTop = style.keepOnTop;
      }
    },
    listen() {
      return () => {};
    },
    async destroy() {},
  } as OpentrayWindow & { visible: boolean; keepOnTop: boolean };
}

/**
 * Fake tray handle: records menu-click subscribers.
 */
function makeTray(): OpentrayTray & { fireClick(itemId?: number): void } {
  let click: ((e: { itemId: number }) => void) | undefined;
  return {
    onMenuClick(handler) {
      click = handler;
      return () => {
        click = undefined;
      };
    },
    async setIcon() {},
    async destroy() {},
    fireClick(itemId = 1) {
      click?.({ itemId });
    },
  } as OpentrayTray & { fireClick(itemId?: number): void };
}

const sandbox = path.join(os.tmpdir(), `pnpm-pub-tray-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

describe('TrayHost visibility (Chapter 6.4)', () => {
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

  it('toggles the window on repeated tray menu click for keepOnTop panels', async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, {
      title: 'pnpm-pub',
      openItemId: 1,
      keepOnTop: true,
    });

    tray.fireClick(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.visible).toBe(true);
    expect(window.keepOnTop).toBe(true);
    expect(host.getVisibility()).toBe('shown');

    tray.fireClick(1);
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe('hidden');
    await host.destroy();
  });

  it('preserves initial visible state and first tray click hides a mounted panel', async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    window.visible = true;
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, {
      title: 'pnpm-pub',
      openItemId: 1,
      keepOnTop: true,
      initialVisible: true,
    });

    expect(host.getVisibility()).toBe('shown');
    tray.fireClick(1);
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe('hidden');
    await host.destroy();
  });

  it('hide() is a pure visibility op and does not touch pending events', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: 'pnpm-pub' });

    // A pending event exists.
    const evt = store.createEvent({ kind: 'publish', profile: 'alice' });
    host.show();
    expect(window.visible).toBe(true);

    // Hiding must NOT reject the pending event (the old behavior did).
    host.hide();
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe('hidden');
    const stillPending = store.getEvents().find((e) => e.id === evt.id);
    expect(stillPending?.status).toBe('pending');
    await host.destroy();
  });

  it('logs non-Error opentray command rejections without erasing the source text', async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const lines: string[] = [];
    window.show = async () => {
      throw 'runtime binding offline';
    };
    const host = new TrayHost(store, makeTray(), window, {
      title: 'pnpm-pub',
      log: (line) => lines.push(line),
    });

    host.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toContain('[tray] show failed: runtime binding offline');
    await host.destroy();
  });
});
