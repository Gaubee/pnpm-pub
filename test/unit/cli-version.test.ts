/**
 * CLI `version` subcommand regressions (Chapter 7.1).
 *
 * `pnpm-pub version` prints pnpm-pub's OWN version (the management-subcommand
 * surface). This is distinct from `pnpm-pub --version`, which is a publish
 * terminal intent (Chapter 7.1.2) that forwards verbatim to
 * `pnpm publish --version` (≡ `pnpm --version`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockState = vi.hoisted((): { responseFrames: unknown[]; frames: unknown[] } => ({
  responseFrames: [],
  frames: [],
}));

// Mock node:net so the CLI never spawns or contacts a real daemon. The version
// subcommand must short-circuit before any IPC, so the socket is never used —
// but mocking keeps the test hermetic if routing ever regresses.
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events');

  class CliVersionMockSocket extends EventEmitter {
    write(chunk: Buffer | Uint8Array | string): boolean {
      mockState.frames.push(String(chunk));
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

  const socket = new CliVersionMockSocket();

  return {
    default: {
      createConnection: vi.fn(() => {
        setImmediate(() => socket.emit('connect'));
        return socket;
      }),
    },
  };
});

describe('CLI version subcommand', () => {
  beforeEach(() => {
    vi.resetModules();
    mockState.frames = [];
    mockState.responseFrames = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario: Given the version subcommand, When run, Then it prints pnpm-pub version and exits 0 without IPC', async () => {
    const { main } = await import('../../src/cli/cli.js');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await main(['node', 'pnpm-pub', 'version']);
    } catch (err) {
      expectExitCode(err, 0);
    }

    // Prints a semver-ish version line.
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringMatching(/^\d+\.\d+\.\d+\S*\n$/));
    // Must not contact the daemon — version is resolved entirely client-side.
    expect(mockState.frames).toEqual([]);
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
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
