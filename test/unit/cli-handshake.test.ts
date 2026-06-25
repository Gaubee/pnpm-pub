/**
 * CLI version-handshake loop tests (Chapter 7.2.1).
 *
 * Simulates the daemon returning the `daemon-outdated` self-destruct signal on
 * the first connection, then a fresh daemon that accepts the publish. Asserts
 * the CLI re-spawns and retries rather than failing out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { setHomeOverride, socketPath } from '../../src/shared/paths.js';
import { encodeFrame } from '../../src/shared/frame.js';

// SHORT path — macOS limits Unix socket paths to ~104 chars.
const sandbox = `/tmp/pp-cli-${process.pid}`;

// We drive the CLI's runPublish by importing main() and feeding argv. To avoid
// actually spawning node, we mock child_process.spawn to a no-op and stand up a
// real in-process IPC server that emulates the daemon's handshake behavior.

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((..._args: unknown[]) => ({
      unref() {},
      on() {},
      kill() {},
    })),
  };
});

let server: net.Server;
let connectionCount = 0;
/** First connection: emit daemon-outdated; subsequent: accept & succeed. */
function makeServer(): net.Server {
  return net.createServer((socket) => {
    connectionCount++;
    const isFirst = connectionCount === 1;
    let sawHandshake = false;
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      // First frame is always the handshake.
      if (!sawHandshake) {
        if (!buf.includes('cliVersion')) return;
        sawHandshake = true;
        if (isFirst) {
          // Old daemon: self-destruct signal.
          socket.write(encodeFrame({ type: 'exit', code: 0, message: 'daemon-outdated' }));
          socket.end();
        }
        buf = '';
        return;
      }
      // Second connection: wait for the publish intent, then succeed.
      if (buf.includes('"command":"publish"')) {
        socket.write(encodeFrame({ type: 'stdout', data: 'publishing...\n' }));
        socket.write(encodeFrame({ type: 'exit', code: 0 }));
        socket.end();
        buf = '';
      }
    });
  });
}

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  setHomeOverride(sandbox);
  connectionCount = 0;
  // Ensure the socket parent dir exists (socketPath() lives under runDir()).
  const sock = socketPath();
  await fsp.mkdir(path.dirname(sock), { recursive: true });
  try {
    await fsp.unlink(sock);
  } catch {
    /* ignore */
  }
  server = makeServer();
  await new Promise<void>((r) => server.listen(sock, r));
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe('CLI version-handshake loop (Chapter 7.2.1)', () => {
  it('re-spawns and retries publish after a daemon-outdated signal', async () => {
    const { main } = await import('../../src/cli/cli.js');
    // Capture the exit code the CLI would have used.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new ExitCode(code ?? 0);
    });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Stub spawn to no-op so the loop doesn't actually fork.
    const { spawn } = await import('node:child_process');
    vi.mocked(spawn).mockImplementation((() => ({ unref() {}, on() {}, kill() {} })) as never);

    try {
      await main(['node', 'pnpm-pub', 'publish']);
    } catch (e) {
      // The first connection returned daemon-outdated; the loop re-spawns
      // (no-op) and retries. The second connection publishes successfully and
      // the CLI calls process.exit(0).
      expect(e).toBeInstanceOf(ExitCode);
      expect((e as ExitCode).code).toBe(0);
    }

    // The server must have been contacted twice (outdated, then publish).
    expect(connectionCount).toBe(2);
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

class ExitCode {
  constructor(public code: number) {}
}
