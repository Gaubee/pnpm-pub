/**
 * Daemon logging tests — secret-bearing lifecycle material must not be serialized.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { bootDaemon } from "../../src/daemon/index.js";
import { daemonLogPath, setHomeOverride } from "../../src/shared/paths.js";

const trayMocks = vi.hoisted(() => ({
  // tryCreateTray uses opentray 0.10's public createTray(options, runtime) API.
  // createTray resolves to a handle whose extend() yields the WebView-capable
  // tray surface; tests override this to simulate failure modes.
  createTray: vi.fn(),
  placementWatch: vi.fn(),
}));

vi.mock("opentray", () => ({
  createTray: trayMocks.createTray,
}));

vi.mock("@opentray/ext-webview", () => ({
  WebviewExt: Symbol("WebviewExt"),
  WebviewPlacementKit: class {
    watch(
      target: unknown,
      options: {
        placement: string;
        width: number;
        height: number;
        placementMargin?: number;
      },
    ): Promise<unknown> {
      return Promise.resolve(trayMocks.placementWatch(target, options));
    }
  },
}));

/**
 * A complete fake tray+window surface matching the SDK shape tryCreateTray
 * drives: createTray() -> EventfulTrayHandle, whose extend() yields
 * WebviewTrayCapability with createWebviewWindow. Individual tests override
 * the pieces they want to break.
 */
function makeHappyMount() {
  const panel = {
    show: async () => {},
    hide: async () => {},
    setStyle: async () => ({}),
    listen: () => () => {},
    destroy: async () => {},
  };
  return {
    extend: () => ({
      onMenuClick: () => () => {},
      setIcon: async () => {},
      setTooltip: async () => {},
      setMenu: async () => {},
      getBounds: async () => ({
        kind: "native",
        source: "fake",
        rect: { x: 0, y: 0, width: 1, height: 1 },
      }),
      getScreenDetails: async () => ({ currentScreen: null, screens: [], isExtended: false }),
      destroy: async () => {},
      createWebviewWindow: () => panel,
    }),
  };
}

const sandbox = path.join("/tmp", `ppdl-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
  trayMocks.createTray.mockReset();
  trayMocks.placementWatch.mockReset();
  trayMocks.placementWatch.mockResolvedValue({ stop: () => {} });
});

afterEach(async () => {
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("bootDaemon logging", () => {
  it("Scenario: Given daemon startup, When logging WebUI availability, Then the WebToken is redacted", async () => {
    const handles = await bootDaemon({
      cliVersion: "0.1.0",
      withTray: false,
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), "utf8");
      expect(log).toContain("WebUI available at http://127.0.0.1:");
      expect(log).toContain("#token=<redacted>");
      expect(log).not.toContain(handles.webToken);
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it("Scenario: Given the runtime binding rejects with a non-Error value, When daemon starts, Then the log preserves the source text", async () => {
    trayMocks.createTray.mockRejectedValueOnce("native binding offline");

    const handles = await bootDaemon({
      cliVersion: "0.1.0",
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), "utf8");
      expect(log).toContain(
        "opentray mount failed ([missing-native-package@runtime-binding] native binding offline) — running headless",
      );
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it("Scenario: Given tray placement rejects with a non-Error value, When daemon starts, Then the log preserves the source text", async () => {
    trayMocks.createTray.mockResolvedValueOnce(makeHappyMount());
    trayMocks.placementWatch.mockRejectedValueOnce("screen authority missing");

    const handles = await bootDaemon({
      cliVersion: "0.1.0",
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), "utf8");
      expect(log).toContain(
        "placement watch failed (screen authority missing) — window unanchored",
      );
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it("Scenario: Given the tray surface lacks placement authorities, When daemon starts, Then placement is skipped but the window still mounts", async () => {
    trayMocks.createTray.mockResolvedValueOnce({
      extend: () => ({
        onMenuClick: () => () => {},
        setIcon: async () => {},
        setTooltip: async () => {},
        setMenu: async () => {},
        destroy: async () => {},
        createWebviewWindow: () => ({
          show: async () => {},
          hide: async () => {},
          setStyle: async () => ({}),
          listen: () => () => {},
          destroy: async () => {},
        }),
        // No getBounds / getScreenDetails → placement authorities unavailable.
      }),
    });

    const handles = await bootDaemon({
      cliVersion: "0.1.0",
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), "utf8");
      expect(log).toContain("placement authorities unavailable — window unanchored");
      expect(log).toContain("opentray webview window mounted");
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it("Scenario: Given createWebviewWindow throws, When daemon starts, Then the daemon degrades to headless mode", async () => {
    trayMocks.createTray.mockResolvedValueOnce({
      extend: () => ({
        onMenuClick: () => () => {},
        setIcon: async () => {},
        setTooltip: async () => {},
        setMenu: async () => {},
        destroy: async () => {},
        createWebviewWindow: () => {
          throw "native webview unavailable";
        },
      }),
    });

    const handles = await bootDaemon({
      cliVersion: "0.1.0",
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), "utf8");
      expect(log).toContain(
        "opentray mount failed ([missing-webview-package@window-create] native webview unavailable) — running headless",
      );
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it("Scenario: Given strict tray mount mode and missing native binding, When daemon starts, Then it throws a typed tray mount error", async () => {
    trayMocks.createTray.mockRejectedValueOnce(
      Object.assign(new Error("OpenTray runtime package missing"), {
        code: "OPENTRAY_MISSING_PLATFORM_RUNTIME_BINDING",
      }),
    );

    await expect(
      bootDaemon({
        cliVersion: "0.1.0",
        strictTrayMount: true,
      }),
    ).rejects.toMatchObject({
      name: "TrayMountError",
      kind: "missing-native-package",
      stage: "runtime-binding",
    });
  });
});
