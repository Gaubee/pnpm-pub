/**
 * Daemon logging tests — secret-bearing lifecycle material must not be serialized.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { bootDaemon } from '../../src/daemon/index.js';
import { daemonLogPath, setHomeOverride } from '../../src/shared/paths.js';

const trayMocks = vi.hoisted(() => ({
  createTray: vi.fn(),
  placementWatch: vi.fn(),
}));

vi.mock('opentray', () => ({
  createTray: trayMocks.createTray,
}));

vi.mock('@opentray/ext-webview', () => ({
  WebviewExt: Symbol('WebviewExt'),
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

const sandbox = path.join('/tmp', `ppdl-${process.pid}-${Date.now()}`);

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

describe('bootDaemon logging', () => {
  it('Scenario: Given daemon startup, When logging WebUI availability, Then the WebToken is redacted', async () => {
    const handles = await bootDaemon({
      cliVersion: '0.1.0',
      withTray: false,
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), 'utf8');
      expect(log).toContain('WebUI available at http://127.0.0.1:');
      expect(log).toContain('#token=<redacted>');
      expect(log).not.toContain(handles.webToken);
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it('Scenario: Given opentray mount rejects with a non-Error value, When daemon starts, Then the log preserves the source text', async () => {
    trayMocks.createTray.mockRejectedValueOnce('native bridge offline');

    const handles = await bootDaemon({
      cliVersion: '0.1.0',
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), 'utf8');
      expect(log).toContain('opentray mount failed (native bridge offline) — running headless');
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it('Scenario: Given tray placement rejects with a non-Error value, When daemon starts, Then the log preserves the source text', async () => {
    trayMocks.createTray.mockResolvedValueOnce({
      extend: () => ({
        onMenuClick: () => () => {},
        setTitle: async () => {},
        destroy: async () => {},
        createWebviewWindow: () => ({
          show: async () => {},
          hide: async () => {},
          setStyle: async () => {},
          listen: () => () => {},
          destroy: async () => {},
        }),
        getBounds: async () => ({}),
        getScreenDetails: async () => ({}),
      }),
    });
    trayMocks.placementWatch.mockRejectedValueOnce('screen authority missing');

    const handles = await bootDaemon({
      cliVersion: '0.1.0',
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), 'utf8');
      expect(log).toContain('placement watch failed (screen authority missing) — window unanchored');
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it('Scenario: Given opentray returns a malformed tray handle, When daemon starts, Then the daemon degrades to headless mode', async () => {
    trayMocks.createTray.mockResolvedValueOnce({
      extend: () => ({
        setTitle: async () => {},
        destroy: async () => {},
      }),
    });

    const handles = await bootDaemon({
      cliVersion: '0.1.0',
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), 'utf8');
      expect(log).toContain('opentray tray handle invalid — running headless');
    } finally {
      await handles.stop({ exit: false });
    }
  });

  it('Scenario: Given opentray returns a malformed WebView window, When daemon starts, Then the window handle is not trusted', async () => {
    trayMocks.createTray.mockResolvedValueOnce({
      extend: () => ({
        onMenuClick: () => () => {},
        setTitle: async () => {},
        destroy: async () => {},
        createWebviewWindow: () => ({
          show: async () => {},
        }),
      }),
    });

    const handles = await bootDaemon({
      cliVersion: '0.1.0',
    });
    expect(handles).not.toBeNull();
    if (!handles) return;

    try {
      const log = await fsp.readFile(daemonLogPath(), 'utf8');
      expect(log).toContain('createWebviewWindow unavailable — running headless');
    } finally {
      await handles.stop({ exit: false });
    }
  });
});
