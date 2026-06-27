/**
 * CLI start command regressions (Chapter 7.1.1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrameReader, isIpcRequest } from '../../src/shared/frame.js';
import type { IpcFrame, IpcRequest } from '../../src/shared/index.js';

const mockState = vi.hoisted((): { responseFrames: IpcFrame[]; frames: IpcRequest[] } => ({
  responseFrames: [{ type: 'status', active: true }],
  frames: [],
}));

vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');

  class CliStartMockSocket extends EventEmitter {
    write(chunk: Buffer | Uint8Array | string): boolean {
      const reader = new FrameReader();
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (isIpcRequest(frame)) {
          mockState.frames.push(frame);
        }
        if (isIpcRequest(frame) && 'command' in frame && frame.command === 'start') {
          setImmediate(() => {
            const payload = `${mockState.responseFrames.map((item) => JSON.stringify(item)).join('\n')}\n`;
            this.emit('data', Buffer.from(payload, 'utf8'));
          });
        }
      }
      return true;
    }

    end(): this {
      setImmediate(() => this.emit('close'));
      return this;
    }

    destroy(): this {
      setImmediate(() => this.emit('close'));
      return this;
    }
  }

  const socket = new CliStartMockSocket();

  return {
    default: {
      createConnection: vi.fn(() => {
        setImmediate(() => socket.emit('connect'));
        return socket;
      }),
    },
  };
});

describe('CLI start command', () => {
  beforeEach(() => {
    vi.resetModules();
    mockState.responseFrames = [{ type: 'status', active: true }];
    mockState.frames = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario: Given start --profile, When the daemon accepts the profile, Then CLI sends the start frame and prints success', async () => {
    const { main } = await import('../../src/cli/cli.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'start', '--profile=work']);
    } catch (err) {
      expectExitCode(err, 0);
    }

    expect(mockState.frames).toContainEqual({ command: 'start', profileOverride: 'work' });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon started.'));
    expect(stderrSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('Scenario: Given start --profile, When the daemon rejects the profile, Then CLI surfaces the daemon exit frame', async () => {
    mockState.responseFrames = [{
      type: 'exit',
      code: 1,
      message: 'Profile "ghost" not found. Add it via the tray GUI first.',
    }];
    const { main } = await import('../../src/cli/cli.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'start', '--profile=ghost']);
    } catch (err) {
      expectExitCode(err, 1);
    }

    expect(mockState.frames).toContainEqual({ command: 'start', profileOverride: 'ghost' });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Profile "ghost" not found'));
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('Daemon started.'));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('Scenario: Given start --profile=, When CLI parses it, Then it fails locally before IPC', async () => {
    const { main } = await import('../../src/cli/cli.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'start', '--profile=']);
    } catch (err) {
      expectExitCode(err, 1);
    }

    expect(mockState.frames).toEqual([]);
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('Daemon started.'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--profile requires a value'));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });


  it('Scenario: Given start --profile receives daemon stderr before rejection, When relaying the verdict, Then CLI preserves the stderr stream', async () => {
    mockState.responseFrames = [
      { type: 'stderr', data: 'Checking requested profile...\n' },
      {
        type: 'exit',
        code: 1,
        message: 'Profile "ghost" not found. Add it via the tray GUI first.',
      },
    ];
    const { main } = await import('../../src/cli/cli.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'start', '--profile=ghost']);
    } catch (err) {
      expectExitCode(err, 1);
    }

    expect(stderrSpy).toHaveBeenCalledWith('Checking requested profile...\n');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Profile "ghost" not found'));
    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('Daemon started.'));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

class ExitCode {
  constructor(public code: number) {}
}

function expectExitCode(value: unknown, code: number): void {
  expect(value).toBeInstanceOf(ExitCode);
  if (!(value instanceof ExitCode)) {
    throw new Error('Expected process.exit to throw ExitCode.');
  }
  expect(value.code).toBe(code);
}
