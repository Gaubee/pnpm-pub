/**
 * CLI stop regression (Chapter 7.1.1 / 7.2.4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrameReader, isIpcRequest } from '../../src/shared/frame.js';
import type { IpcRequest } from '../../src/shared/index.js';

const mockState = vi.hoisted((): { frames: IpcRequest[] } => ({
  frames: [],
}));

vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');

  class CliStopMockSocket extends EventEmitter {
    write(chunk: Buffer | Uint8Array | string): boolean {
      const reader = new FrameReader();
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (isIpcRequest(frame)) {
          mockState.frames.push(frame);
        }
        this.emit('frame', frame);
      }
      return true;
    }

    end(): this {
      this.emit('close');
      return this;
    }

    destroy(): this {
      this.emit('close');
      return this;
    }
  }

  const socket = new CliStopMockSocket();

  return {
    default: {
      createConnection: vi.fn(() => {
        setImmediate(() => socket.emit('connect'));
        return socket;
      }),
    },
  };
});

describe('CLI stop command', () => {
  beforeEach(() => {
    vi.resetModules();
    mockState.frames = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario: Given a stop command, When the daemon socket opens, Then CLI sends the stop frame and prints an acknowledgement', async () => {
    const { main } = await import('../../src/cli/cli.js');
    const net = await import('node:net');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'stop']);
    } catch {
      /* ignore exit throw */
    }

    expect(net.default.createConnection).toHaveBeenCalled();
    expect(mockState.frames).toContainEqual({ command: 'stop' });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Stop signal sent.'));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

class ExitCode {
  constructor(public code: number) {}
}
