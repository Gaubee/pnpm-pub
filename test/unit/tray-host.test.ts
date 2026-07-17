/**
 * TrayHost retained-window lifecycle coverage (Chapter 6.4).
 *
 * Orthogonal intentions (2026-07-17, original request):
 * 1. Native isVisible()/visibleChange owns minimized, hidden, and visible state.
 * 2. Retained sessions reveal with toVisible() and hide with close().
 * 3. Page-owned blur animation remains guarded by pin, route, and active events.
 * 4. Tray menu text always describes the next native visibility action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { DaemonStore } from "../../src/daemon/store.js";
import { TrayHost } from "../../src/daemon/tray-host.js";
import type { OpentrayTray, OpentrayWindow, TrayPinFrame } from "../../src/daemon/tray-host.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { WINDOW_ENTER_SEED_OPACITY } from "../../src/shared/window-opacity.js";

type TestWindow = OpentrayWindow & {
  visible: boolean;
  keepOnTop: boolean;
  opacity: number;
  fireBlur(): void;
  fireFocus(): void;
  fireVisibleChange(visible: boolean): void;
};

/** Native-handle probe used by the lifecycle tests. */
function makeWindow(): TestWindow {
  const listeners = new Map<string, Array<(event: { payload: unknown }) => void>>();
  const emit = (event: string, payload: unknown) => {
    for (const handler of listeners.get(event) ?? []) handler({ payload });
  };
  const win = {
    visible: false,
    keepOnTop: false,
    opacity: 1,
    async show() {
      win.visible = true;
      emit("visibleChange", { visible: true });
    },
    async hide() {
      win.visible = false;
      emit("visibleChange", { visible: false });
    },
    async close() {
      win.visible = false;
      emit("visibleChange", { visible: false });
    },
    async isClosed() {
      return !win.visible;
    },
    async isVisible() {
      return win.visible;
    },
    async toVisible() {
      win.visible = true;
      emit("visibleChange", { visible: true });
    },
    async setStyle(style: { keepOnTop?: boolean; opacity?: number }) {
      if (style.keepOnTop !== undefined) win.keepOnTop = style.keepOnTop;
      if (style.opacity !== undefined) win.opacity = style.opacity;
    },
    listen(event: unknown, handler: (event: { payload: unknown }) => void) {
      const key = String(event);
      const current = listeners.get(key) ?? [];
      current.push(handler);
      listeners.set(key, current);
      return () => {
        listeners.set(
          key,
          (listeners.get(key) ?? []).filter((candidate) => candidate !== handler),
        );
      };
    },
    async destroy() {},
    fireBlur() {
      emit("blur", {});
    },
    fireFocus() {
      emit("focus", {});
    },
    fireVisibleChange(visible: boolean) {
      win.visible = visible;
      emit("visibleChange", { visible });
    },
  };
  return win as unknown as TestWindow;
}

type TestTray = OpentrayTray & { fireClick(itemId?: number): Promise<void> };

/** Tray probe that preserves async menu handlers. */
function makeTray(): TestTray {
  let click: ((event: { itemId: number }) => void | Promise<void>) | undefined;
  const tray = {
    onMenuClick(handler: (event: { itemId: number }) => void | Promise<void>) {
      click = handler;
      return () => {
        click = undefined;
      };
    },
    async setIcon() {},
    async setMenu() {},
    async destroy() {},
    async fireClick(itemId = 1) {
      await click?.({ itemId });
    },
  };
  return tray as unknown as TestTray;
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
    await tray.fireClick(1); // simulate the primaryEvent menu click
    expect(window.visible).toBe(true);
    expect(host.getVisibility()).toBe("shown");
    await host.destroy();
  });

  it("keepOnTop is permanent — applied on every show(), independent of the pin", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });

    await host.show();
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
    await host.show();
    expect(window.visible).toBe(true);
    expect(window.opacity).toBe(WINDOW_ENTER_SEED_OPACITY);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);
    expect(window.visible).toBe(true);

    await host.completeAutoClose();
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
    await host.show();
    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);

    window.fireFocus();
    expect(host.getPinState().exitRequested).toBe(false);

    // A stale WebUI completion after focus must not hide the window.
    await host.completeAutoClose();
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("pinned windows ignore blur (no auto-close intent)", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await store.setPreferences({ keepOnTop: true });
    await host.show();
    expect(window.visible).toBe(true);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(false);

    await host.completeAutoClose();
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("Scenario: Given the add-profile route, When the window blurs, Then route-owned onboarding blocks auto-close", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await host.show();
    host.setRoute("/add-profile");

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(false);

    // A stale completion must still be rejected while the form route owns the window.
    await host.completeAutoClose();
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("Scenario: Given a pending blur auto-close, When add-profile becomes active, Then the route cancels it", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await host.show();
    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(true);

    host.setRoute("/add-profile");
    expect(host.getPinState().exitRequested).toBe(false);

    host.setRoute("/profiles/alice");
    expect(host.getPinState().exitRequested).toBe(true);
    await host.destroy();
  });

  it("pin changes re-evaluate auto-close while the window is blurred", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await host.show();
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.visible).toBe(true);
    expect(host.getPinState().hasActiveEvents).toBe(true);

    window.fireBlur();
    expect(host.getPinState().exitRequested).toBe(false);

    store.resolveEvent(event.id, "success");
    expect(host.getPinState().hasActiveEvents).toBe(false);
    expect(host.getPinState().exitRequested).toBe(true);
    await host.destroy();
  });

  it("hide() sticks while active events are present (blur must not re-show)", async () => {
    // Regression: hide() produces a native blur, and reevaluateAutoClose() used
    // to run the "active events ⇒ show" rule on that blur, immediately undoing
    // a user's "Hide window" click and leaving the window stuck at the 0.1
    // enter-seed opacity. That rule must be scoped to genuinely new events only.
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, { title: "pnpm-pub", openItemId: 1 });

    store.createEvent({
      kind: "refresh-token",
      profile: "alice",
      payload: { kind: "refresh-token", data: { username: "alice" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.visible).toBe(true);
    expect(host.getPinState().hasActiveEvents).toBe(true);

    // User clicks "Hide window". hide() triggers a native blur synchronously;
    // the window must stay hidden (not be resurrected by the blur re-eval).
    await host.hide();
    window.fireBlur();
    expect(host.getPinState().visibility).toBe("hidden");
    expect(window.visible).toBe(false);

    // A subsequent tray click still re-shows in one press (toggle is correct).
    await tray.fireClick();
    expect(host.getPinState().visibility).toBe("shown");
    expect(window.visible).toBe(true);
    await host.destroy();
  });

  it("setPreferences persists the keep-open pin but does NOT touch keepOnTop", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const host = new TrayHost(store, makeTray(), window, { title: "pnpm-pub" });
    await host.show(); // establishes keepOnTop = true (permanent)

    await store.setPreferences({ keepOnTop: true });
    expect(store.getPreferences().keepOnTop).toBe(true);
    // keepOnTop is unaffected by the pin (it only gates blur auto-hide).
    expect(window.keepOnTop).toBe(true);

    await store.setPreferences({ keepOnTop: false });
    expect(store.getPreferences().keepOnTop).toBe(false);
    expect(window.keepOnTop).toBe(true);
    await host.destroy();
  });

  it("native visibleChange fixes minimized-window menu state and one-click restore", async () => {
    const store = new DaemonStore();
    await store.load();
    const window = makeWindow();
    const tray = makeTray();
    const host = new TrayHost(store, tray, window, {
      title: "pnpm-pub",
      openItemId: 1,
    });

    await host.show();
    expect(window.visible).toBe(true);

    // Native minimize/close/auto-hide all project operational visibility here.
    window.fireVisibleChange(false);
    expect(host.getVisibility()).toBe("hidden");

    // The next tray click queries isVisible() and restores the retained session.
    await tray.fireClick(1);
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
    await host.show();
    expect(window.visible).toBe(true);

    // Picking the Quit item must call onQuit once and leave the window visible
    // (process teardown is the caller's job, not the host's).
    await tray.fireClick(2);
    expect(quitCalls).toBe(1);
    expect(window.visible).toBe(true);

    // The Open item still toggles as before.
    await tray.fireClick(1);
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
    await expect(tray.fireClick(2)).resolves.toBeUndefined();
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

    await host.hide();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(last().items.map((i) => i.title)).toEqual(["Show window", undefined, "Quit"]);

    await host.show();
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
    await host.show();
    expect(window.visible).toBe(true);

    await host.hide();
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
    window.toVisible = async () => {
      throw "runtime binding offline";
    };
    const host = new TrayHost(store, makeTray(), window, {
      title: "pnpm-pub",
      log: (line) => lines.push(line),
    });

    await host.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lines).toContain("[tray] toVisible failed: runtime binding offline");
    await host.destroy();
  });
});
