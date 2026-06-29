import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

class FakeChild extends EventEmitter {
  killed = false;
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.killed = true;
    queueMicrotask(() => {
      this.emit('exit', signal === 'SIGINT' ? 0 : 0, signal);
      this.emit('close', 0, signal);
    });
    return true;
  });
}

class StubbornChild extends FakeChild {
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.killed = true;
    if (signal === 'SIGKILL') {
      queueMicrotask(() => {
        this.emit('exit', null, signal);
        this.emit('close', null, signal);
      });
    }
    return true;
  });
}

function makeSpawnSequence(...children: FakeChild[]) {
  return vi.fn(() => {
    const child = children.shift();
    if (!child) throw new Error('unexpected spawn');
    return child as never;
  });
}

describe('pnpm dev supervisor', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.useRealTimers();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('Scenario: Given live dev servers, When the supervisor starts, Then it spawns Vite and daemon without waiting for a WebUI build', async () => {
    const webui = new FakeChild('webui');
    const daemon = new FakeChild('daemon');
    const spawn = makeSpawnSequence(webui, daemon);
    const { main } = await import('../../src/dev.js');

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    process.emit('SIGINT', 'SIGINT');
    await run;

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      'pnpm',
      expect.arrayContaining(['--dir', 'webui', 'exec', 'vite', 'dev']),
      expect.objectContaining({
        env: expect.objectContaining({ PNPM_PUB_DEV_DAEMON_PORT: expect.any(String) }),
      }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'pnpm',
      ['exec', 'tsx', 'src/daemon/dev.ts'],
      expect.objectContaining({
        env: expect.objectContaining({
          PNPM_PUB_DEV_DAEMON_PORT: expect.any(String),
          PNPM_PUB_DEV_WEBVIEW_URL: expect.stringContaining('__PNPM_PUB_WEB_TOKEN__'),
        }),
      }),
    );
    expect(webui.kill).toHaveBeenCalledWith('SIGINT');
    expect(daemon.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('Scenario: Given Ctrl-C during startup, When the supervisor handles SIGINT, Then it stops managed children', async () => {
    const webui = new FakeChild('webui');
    const daemon = new FakeChild('daemon');
    const spawn = makeSpawnSequence(webui, daemon);
    const { main } = await import('../../src/dev.js');

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    process.emit('SIGINT', 'SIGINT');
    await run;

    expect(webui.kill).toHaveBeenCalledWith('SIGINT');
    expect(daemon.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('Scenario: Given a daemon ignores graceful shutdown, When the supervisor handles SIGINT, Then it force-kills the daemon group', async () => {
    vi.useFakeTimers();
    const webui = new FakeChild('webui');
    const daemon = new StubbornChild('daemon');
    const spawn = makeSpawnSequence(webui, daemon);
    const { main } = await import('../../src/dev.js');

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    process.emit('SIGINT', 'SIGINT');
    await vi.advanceTimersByTimeAsync(2_000);
    await run;

    expect(daemon.kill).toHaveBeenCalledWith('SIGINT');
    expect(daemon.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
