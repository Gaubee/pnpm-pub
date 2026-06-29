/**
 * Release daemon entrypoint test.
 *
 * Verifies that the packaged daemon (main.ts) boots bootDaemon with the
 * package version and dev webview URL. bootDaemon itself is mocked here so no
 * native opentray runtime is actually spawned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readExpectedPackageVersion } from '../helpers/package-version.js';

const mocks = vi.hoisted(() => ({
  bootDaemon: vi.fn(async () => ({} as never)),
}));

vi.mock('../../src/daemon/index.js', () => ({ bootDaemon: mocks.bootDaemon }));

describe('src/daemon/main.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.bootDaemon.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario: Given the release daemon entrypoint, When it boots, Then it delegates to bootDaemon with the package version', async () => {
    await import('../../src/daemon/main.js');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.bootDaemon).toHaveBeenCalledTimes(1);
    const firstCall = mocks.bootDaemon.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error('bootDaemon was not called');
    const [opts] = firstCall;
    expect(opts.cliVersion).toBe(readExpectedPackageVersion());
    expect(opts.webviewUrl).toBeUndefined();
  });
});
