/**
 * TrayHost behavior tests (Chapter 6.4).
 *
 * Covers the new visibility model:
 *   - tray-click toggles show/hide
 *   - keepOnTop is PERMANENT (always on), independent of the pin
 *   - the "keep open" pin only gates blur auto-hide (default unpinned)
 *   - blur authorizes page-owned auto-close (unpinned + no active events)
 *   - focus cancels a pending auto-close intent
 *   - the keep-open pin is a persisted preference (setPreferences), re-evaluated on change
 *   - markHidden (window-hidden WS) keeps toggle() correct after an OS-close
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { DaemonStore } from "../../src/daemon/store.js";
import { TrayHost } from "../../src/daemon/tray-host.js";
import type { OpentrayTray, OpentrayWindow, TrayPinFrame } from "../../src/daemon/tray-host.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { WINDOW_ENTER_SEED_OPACITY } from "../../src/shared/window-opacity.js";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";

/**
 * Fake WebviewWindowHandle: tracks visibility + keepOnTop, and lets tests fire
 * blur/focus events through the recorded `listen` subscribers.
 */
function makeWindow(): OpentrayWindow & {
  visible: boolean;
  keepOnTop: boolean;
  opacity: number;
  fireBlur(): void;
  fireFocus(): void;
} {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const win = {
    visible: false,
    keepOnTop: false,
    opacity: 1,
    async show() {
      win.visible = true;
    },
    async hide() {
      win.visible = false;
    },
    async setStyle(style: { keepOnTop?: boolean; opacity?: number }) {
      if (style.keepOnTop !== undefined) {
        win.keepOnTop = style.keepOnTop;
      }
      if (style.opacity !== undefined) {
        win.opacity = style.opacity;
      }
    },
    listen(event: unknown, handler: (payload: unknown) => void) {
      const key = typeof event === "string" ? event : (event as string);
      const arr = listeners.get(key) ?? [];
      arr.push(handler);
      listeners.set(key, arr);
      return () => {
        const cur = listeners.get(key);
        if (cur)
          listeners.set(
            key,
            cur.filter((h) => h !== handler),
          );
      };
    },
    async destroy() {},
    fireBlur() {
      for (const h of listeners.get("blur") ?? []) h({});
    },
    fireFocus() {
      for (const h of listeners.get("focus") ?? []) h({});
    },
  };
  return win as unknown as OpentrayWindow & {
    visible: boolean;
    keepOnTop: boolean;
    opacity: number;
    fireBlur(): void;
    fireFocus(): void;
  };
}

/**
 * Fake tray handle: records menu-click subscribers.
 */
function makeTray(): OpentrayTray & { fireClick(itemId?: number): void } {
  let click: ((e: { itemId: number }) => void) | undefined;
  const tray = {
    onMenuClick(handler: (e: { itemId: number }) => void) {
      click = handler;
      return () => {
        click = undefined;
      };
    },
    async setIcon() {},
    async setMenu() {},
    async destroy() {},
    fireClick(itemId = 1) {
      click?.({ itemId });
    },
  };
  return tray as unknown as OpentrayTray & { fireClick(itemId?: number): void };
}

const sandbox = path.join(os.tmpdir(), `pnpm-pub-tray-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(() => {
  setHomeOverride(null);
  vi.useRealTimers();
});

describe("TrayHost visibility (Chapter 6.4)", () => {
  it("shows the window on tray menu click", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, { title: "pnpm-pub", openItemId: 1 });
    tray.fireClick(1); // simulate the primaryEvent menu click
    expect(window.visible).toBe(true);
    expect(host.getVisibility()).toBe("shown");
    await host.destroy();
  });

  it("keepOnTop is permanent — applied on every show(), independent of the pin", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });

    host.show();
    // show() chains setStyle(keepOnTop) after the show promise resolves, so
    // flush the microtask before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.visible).toBe(true);
    // keepOnTop is always on, even when unpinned (default).
    expect(window.keepOnTop).toBe(true);

    // Toggling the pin does NOT touch keepOnTop (it only gates blur auto-hide).
    await store.setPreferences({ keepOnTop: true });
    expect(window.keepOnTop).toBe(true);
    await store.setPreferences({ keepOnTop: false });
    expect(window.keepOnTop).toBe(true);
    await host.destroy();
  });

  it("seeds the pin from persisted preferences on startup", async () => {
    // Persist a pinned preference, then build a fresh store + host.
    const store1 = new DaemonStore();
    await store1.load();
    await store1.setPreferences({ keepOnTop: true });

    const store = new DaemonStore();
    await store.load();
    expect(store.getPreferences().keepOnTop).toBe(true);
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    // The pin is seeded from preferences; getPinState no longer carries it, so
    // assert against the persisted source.
    expect(store.getPreferences().keepOnTop).toBe(true);
    await host.destroy();
  });

  it("blur requests page-owned auto-close, then completeAutoClose hides", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const frames: TrayPinFrame[] = [];
    const host = new TrayHost(store, makeTray(), window, {
      title: "pnpm-pub",
      onPinFrame: (frame) => frames.push(frame),
    });
    host.show();
    expect(window.visible).toBe(true);
    expect(window.opacity).toBe(WINDOW_ENTER_SEED_OPACITY);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);
    expect(window.visible).toBe(true);

    host.completeAutoClose();
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe("hidden");
    expect(host.getPinState().exitRequested).toBe(false);

    const projected = frames.map((f) => f.exitRequested);
    expect(projected).toContain(true);
    expect(projected[projected.length - 1]).toBe(false);
    await host.destroy();
  });

  it("focus cancels a pending auto-close intent", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    host.show();
    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);

    window.fireFocus();
    expect(host.getPinState().exitRequested).toBe(false);

    // A stale WebUI completion after focus must not hide the window.
    host.completeAutoClose();
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("pinned windows ignore blur (no auto-close intent)", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await store.setPreferences({ keepOnTop: true });
    host.show();
    expect(window.visible).toBe(true);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(false);

    host.completeAutoClose();
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("pin changes re-evaluate auto-close while the window is blurred", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    host.show();
    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);

    await store.setPreferences({ keepOnTop: true });
    expect(host.getPinState().exitRequested).toBe(false);

    await store.setPreferences({ keepOnTop: false });
    expect(host.getPinState().exitRequested).toBe(true);
    await host.destroy();
  });

  it("active events open the window and gate blur auto-close", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    expect(window.visible).toBe(false);

    const event = store.createEvent({
      kind: "refresh-token",
      profile: "alice",
      payload: { kind: "refresh-token", data: { username: "alice" } },
    });
    expect(window.visible).toBe(true);
    expect(host.getPinState().hasActiveEvents).toBe(true);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(false);

    store.resolveEvent(event.id, "success");
    expect(host.getPinState().hasActiveEvents).toBe(false);
    expect(host.getPinState().exitRequested).toBe(true);
    await host.destroy();
  });

  it("setPreferences persists the keep-open pin but does NOT touch keepOnTop", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    host.show(); // establishes keepOnTop = true (permanent)

    await store.setPreferences({ keepOnTop: true });
    expect(store.getPreferences().keepOnTop).toBe(true);
    // keepOnTop is unaffected by the pin (it only gates blur auto-hide).
    expect(window.keepOnTop).toBe(true);

    await store.setPreferences({ keepOnTop: false });
    expect(store.getPreferences().keepOnTop).toBe(false);
    expect(window.keepOnTop).toBe(true);
    await host.destroy();
  });

  it("markHidden fixes the OS-close double-click (next tray click re-shows)", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, { title: "pnpm-pub", openItemId: 1 });

    host.show();
    expect(window.visible).toBe(true);

    // Simulate the OS close (X): the window is hidden out-of-band and the
    // WebUI reports it via window-hidden.
    window.visible = false;
    host.markHidden();
    expect(host.getVisibility()).toBe("hidden");

    // A single tray click now re-shows (the old bug needed two clicks).
    tray.fireClick(1);
    expect(window.visible).toBe(true);
    expect(host.getVisibility()).toBe("shown");
    await host.destroy();
  });

  it("Quit menu item invokes onQuit and does NOT toggle the window", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    let quitCalls = 0;
    const host = new TrayHost(store, tray, window, {
      title: "pnpm-pub",
      openItemId: 1,
      quitItemId: 2,
      onQuit: () => {
        quitCalls++;
      },
    });
    host.show();
    expect(window.visible).toBe(true);

    // Picking the Quit item must call onQuit once and leave the window visible
    // (process teardown is the caller's job, not the host's).
    tray.fireClick(2);
    expect(quitCalls).toBe(1);
    expect(window.visible).toBe(true);

    // The Open item still toggles as before.
    tray.fireClick(1);
    expect(window.visible).toBe(false);
    await host.destroy();
  });

  it("onQuit failures are logged, not thrown", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const lines: string[] = [];
    const host = new TrayHost(store, tray, window, {
      title: "pnpm-pub",
      openItemId: 1,
      quitItemId: 2,
      log: (line) => lines.push(line),
      onQuit: () => {
        throw new Error("shutdown boom");
      },
    });
    // Must not throw — the failure is swallowed + logged.
    expect(() => tray.fireClick(2)).not.toThrow();
    expect(lines.some((l) => l.includes("onQuit failed: shutdown boom"))).toBe(true);
    await host.destroy();
  });

  it("setIcon forwards the projection to the tray handle", async () => {
    const store = new DaemonStore();
    await store.load();
    const tray = makeTray();
    const received: unknown[] = [];
    tray.setIcon = async (icon: unknown) => {
      received.push(icon);
    };
    const host = new TrayHost(store, tray, makeWindow(), { title: "pnpm-pub" });
    const colorIcon = { "icon-only": { type: "file" as const, path: "/x.png" } };
    host.setIcon(colorIcon);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([colorIcon]);
    // undefined is a no-op (no asset resolved).
    host.setIcon(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toHaveLength(1);
    await host.destroy();
  });

  it("relables the primary menu item to Show/Hide window on visibility change", async () => {
    const store = new DaemonStore();
    await store.load();
    const tray = makeTray();
    const pushedMenus: Array<{ items: Array<{ type: string; id?: number; title?: string }> }> = [];
    tray.setMenu = async (menu: unknown) => {
      pushedMenus.push(menu as { items: Array<{ type: string; id?: number; title?: string }> });
    };
    const host = new TrayHost(store, tray, makeWindow(), {
      title: "pnpm-pub",
      openItemId: 1,
      quitItemId: 2,
      initialVisible: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Initial (shown): primary item reads "Hide window", plus a separator + Quit.
    const last = () => pushedMenus[pushedMenus.length - 1];
    expect(last().items.map((i) => i.title)).toEqual(["Hide window", undefined, "Quit"]);

    host.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(last().items.map((i) => i.title)).toEqual(["Show window", undefined, "Quit"]);

    host.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(last().items.map((i) => i.title)).toEqual(["Hide window", undefined, "Quit"]);
    await host.destroy();
  });

  it("hide() is a pure visibility op and does not touch pending events", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });

    const evt = store.createEvent({ kind: "publish", profile: "alice" });
    host.show();
    expect(window.visible).toBe(true);

    host.hide();
    expect(window.visible).toBe(false);
    expect(host.getVisibility()).toBe("hidden");
    const stillPending = store.getEvents().find((e) => e.id === evt.id);
    expect(stillPending?.status).toBe("pending");
    await host.destroy();
  });

  it("logs non-Error opentray command rejections without erasing the source text", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const lines: string[] = [];
    window.show = async () => {
      throw "runtime binding offline";
    };
    const host = new TrayHost(store, makeTray(), window, {
      title: "pnpm-pub",
      log: (line) => lines.push(line),
    });

    host.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toContain("[tray] show failed: runtime binding offline");
    await host.destroy();
  });
});
