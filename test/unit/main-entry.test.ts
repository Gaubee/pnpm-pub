/**
 * Release daemon entrypoint test.
 *
 * Verifies that the packaged daemon boots the tray path by default instead of
 * forcing the headless test flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DaemonOptions } from '../../src/daemon/index.js';
import { readExpectedPackageVersion } from '../helpers/package-version.js';

const mocks = vi.hoisted(() => ({
  bootDaemon: vi.fn(async (_opts: DaemonOptions) => ({ booted: true })),
}));

vi.mock('../../src/daemon/index.js', () => mocks);

describe('src/daemon/main.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.bootDaemon.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario: Given the release daemon entrypoint, When it boots, Then it passes the package version without forcing headless tray mode', async () => {
    await import('../../src/daemon/main.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.bootDaemon).toHaveBeenCalledTimes(1);
    const firstCall = mocks.bootDaemon.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('bootDaemon was not called');
    const [opts] = firstCall;
    expect(opts.cliVersion).toBe(readExpectedPackageVersion());
    expect(opts.withTray).not.toBe(false);
  });
});
