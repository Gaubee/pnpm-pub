/**
 * pnpm-pub CLI entry — the thin client (Chapter 7).
 *
 * Routing (Chapter 7.1):
 *   pnpm-pub start [--profile]    -> spawn daemon + open tray
 *   pnpm-pub status               -> query daemon status
 *   pnpm-pub stop                 -> graceful shutdown
 *   pnpm-pub <anything-else>      -> treated as `pnpm publish <args>` (fallback)
 *
 * The fallback is the key UX guarantee: muscle-memory compatibility with
 * `pnpm publish` (Chapter 7.1.2). yargs is used purely to recognise the three
 * explicit management subcommands; EVERYTHING else is forwarded verbatim to
 * the daemon as a publish intent.
 */
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { encodeFrame, FrameReader, isIpcFrame } from '../shared/frame.js';
import type { IpcPublishRequest, IpcHandshake, IpcManagementRequest } from '../shared/index.js';
import { readPackageVersion } from '../shared/package-version.js';
import { daemonLogPath, ensureAppDirs, socketPath } from '../shared/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The daemon entry the CLI spawns. In the bundled output this is dist/daemon.js
// (sibling of dist/cli.js). For dev (bun/tsx from source) override via env so
// the CLI can launch src/daemon/main.ts directly without a build step.
const DAEMON_ENTRY =
  process.env.PNPM_PUB_DAEMON_ENTRY ?? path.join(__dirname, 'daemon.js');
const CLI_VERSION = readPackageVersion();
const execFileAsync = promisify(execFile);
const PROFILE_ERROR = '--profile requires a value (e.g. --profile alice).';

// ---------------------------------------------------------------------------
// Daemon connection helpers (Chapter 7.2.1 — auto-booting ghost process).
// ---------------------------------------------------------------------------

async function connectWithRetry(maxWaitMs: number): Promise<net.Socket | null> {
  const start = Date.now();
  for (;;) {
    try {
      const sock = await connectOnce();
      if (sock) return sock;
    } catch {
      /* keep trying */
    }
    if (Date.now() - start > maxWaitMs) return null;
    await sleep(150);
  }
}

function connectOnce(): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath());
    sock.once('connect', () => resolve(sock));
    sock.once('error', () => resolve(null));
  });
}

function spawnDaemon(): void {
  // Detached ghost process — outlives the parent terminal (Chapter 5.1.2).
  // Redirect stdout/stderr into the daemon log so IPC errors / uncaught
  // rejections are recoverable instead of going to /dev/null.
  const stdio: Array<'ignore' | number> = ['ignore', 'ignore', 'ignore'];
  try {
    ensureAppDirs();
    const fd = fs.openSync(daemonLogPath(), 'a');
    stdio[1] = fd;
    stdio[2] = fd;
  } catch {
    /* fall back to ignore */
  }
  const child = spawn(process.execPath, [DAEMON_ENTRY], {
    detached: true,
    stdio: stdio as ['ignore' | number, 'ignore' | number, 'ignore' | number],
    env: { ...process.env },
  });
  child.unref();
}

async function ensureDaemon(): Promise<net.Socket | null> {
  let sock = await connectWithRetry(500);
  if (!sock) {
    spawnDaemon();
    sock = await connectWithRetry(10_000);
  }
  return sock;
}

// ---------------------------------------------------------------------------
// Command flows.
// ---------------------------------------------------------------------------

async function runPublish(cwd: string, args: string[], profileOverride?: string): Promise<number> {
  // Version handshake loop (Chapter 7.2.1). When the CLI is newer than the
  // running daemon, the daemon self-exits and returns the `daemon-outdated`
  // signal; the CLI then re-spawns a fresh daemon and retries the publish.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sock, outdated } = await handshakeAndWait();
    if (outdated) {
      // The daemon signaled it is older than the CLI. It has already (or is
      // about to) self-exit; spawn a fresh one and loop.
      try {
        sock?.end();
      } catch {
        /* ignore */
      }
      spawnDaemon();
      await sleep(500); // give the old daemon time to release the socket lock
      continue;
    }
    if (!sock) {
      process.stderr.write('Failed to start the pnpm-pub daemon.\n');
      return 1;
    }

    const req: IpcPublishRequest = { command: 'publish', cwd, args, profileOverride };
    sock.write(encodeFrame(req));

    process.stdout.write('> Waiting for GUI confirmation. Please check your system tray...\n');
    return relay(sock);
  }
  process.stderr.write('Could not bring the daemon up to date after retry.\n');
  return 1;
}

function isPublishTerminalIntent(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--') return false;
    if (arg === '--help' || arg === '-h' || arg === '--version') return true;
  }
  return false;
}

function readExecText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExecExitCode(error: unknown): number {
  if (!isRecord(error)) return 1;
  const code = error.code;
  return typeof code === 'number' ? code : 1;
}

async function runNativePublishTerminalIntent(args: string[]): Promise<number> {
  try {
    const result = await execFileAsync('pnpm', ['publish', ...args], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return 0;
  } catch (error: unknown) {
    if (isRecord(error)) {
      const stdout = readExecText(error.stdout);
      const stderr = readExecText(error.stderr);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
    return readExecExitCode(error);
  }
}

function readProfileValue(value: string | undefined): { profile?: string; error?: string } {
  if (value === undefined) return {};
  if (value.length === 0) return { error: PROFILE_ERROR };
  return { profile: value };
}

/**
 * Send the version handshake and wait briefly to see whether the daemon
 * responds with the `daemon-outdated` self-destruct signal. Returns the live
 * socket plus an `outdated` flag (Chapter 7.2.1).
 *
 * The normal (current) daemon stays silent after the handshake and only acts on
 * the subsequent publish intent — so we wait up to `graceMs` for the outdated
 * signal, and if none arrives we hand the still-open socket to `relay()`. We
 * never detach the data listener (the publish frames arrive on this socket).
 */
function handshakeAndWait(graceMs = 300): Promise<{ sock: net.Socket | null; outdated: boolean }> {
  return new Promise(async (resolve) => {
    const sock = await ensureDaemon();
    if (!sock) return resolve({ sock: null, outdated: false });
    let settled = false;
    const finish = (outdated: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener('data', onData);
      sock.removeListener('close', onClose);
      resolve({ sock: outdated ? null : sock, outdated });
    };
    const onData = (chunk: Buffer): void => {
      // Peek for the outdated signal without consuming the stream — relay()
      // owns frame parsing. We only look for the sentinel string.
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (text.includes('"daemon-outdated"')) {
        finish(true);
      }
    };
    const onClose = (): void => finish(false);
    const timer = setTimeout(() => finish(false), graceMs);

    sock.on('data', onData);
    sock.on('close', onClose);

    sock.write(encodeFrame({ cliVersion: CLI_VERSION } satisfies IpcHandshake));
  });
}

/** Pipe daemon frames to stdout/stderr and resolve on exit frame (Chapter 7.2.4). */
function relay(sock: net.Socket): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FrameReader();
    sock.on('data', (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) {
          process.stderr.write('Invalid daemon IPC frame.\n');
          resolve(1);
          continue;
        }
        if (frame.type === 'stdout') process.stdout.write(frame.data);
        else if (frame.type === 'stderr') process.stderr.write(frame.data);
        else if (frame.type === 'exit') {
          try {
            sock.end();
          } catch {
            /* ignore */
          }
          resolve(frame.code);
        }
      }
    });
    sock.on('close', () => resolve(1));
    sock.on('error', () => resolve(1));
  });
}

async function runStatus(): Promise<number> {
  const sock = await connectWithRetry(500);
  if (!sock) {
    process.stdout.write('Daemon is not running.\n');
    return 0;
  }
  sock.write(encodeFrame({ command: 'status' }));
  await new Promise<void>((resolve) => {
    const reader = new FrameReader();
    sock.on('data', (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) continue;
        if (frame.type === 'status') {
          if (frame.active) {
            process.stdout.write(
              `Daemon running (pid=${frame.pid ?? '?'}). Active profile: ${frame.profile ?? '(none)'}\n`,
            );
          } else {
            process.stdout.write('Daemon is stopping.\n');
          }
          resolve();
        }
      }
    });
    sock.on('close', () => resolve());
  });
  return 0;
}

async function runStop(): Promise<number> {
  const sock = await connectWithRetry(500);
  if (!sock) {
    process.stdout.write('Daemon is not running.\n');
    return 0;
  }
  sock.write(encodeFrame({ command: 'stop' }));
  try {
    sock.end();
  } catch {
    /* ignore */
  }
  process.stdout.write('Stop signal sent.\n');
  return 0;
}

async function runStart(profileOverride?: string): Promise<number> {
  const sock = await ensureDaemon();
  if (!sock) {
    process.stderr.write('Failed to start the pnpm-pub daemon.\n');
    return 1;
  }
  // Chapter 7.1.1: `start [--profile=*]` selects the default identity the
  // daemon should load. We send a management request so the daemon applies it.
  if (profileOverride && profileOverride.length > 0) {
    sock.write(encodeFrame({ command: 'start', profileOverride } satisfies IpcManagementRequest));
    return relayStart(sock);
  }
  try {
    sock.end();
  } catch {
    /* ignore */
  }
  process.stdout.write('Daemon started. Open the tray to interact.\n');
  return 0;
}

function relayStart(sock: net.Socket): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FrameReader();
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      try {
        sock.end();
      } catch {
        /* ignore */
      }
      resolve(code);
    };
    sock.on('data', (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) continue;
        if (frame.type === 'stdout') {
          process.stdout.write(frame.data);
        } else if (frame.type === 'stderr') {
          process.stderr.write(frame.data);
        } else if (frame.type === 'status') {
          process.stdout.write('Daemon started. Open the tray to interact.\n');
          finish(0);
          return;
        } else if (frame.type === 'exit') {
          if (frame.message) process.stderr.write(`${frame.message}\n`);
          finish(frame.code);
          return;
        }
      }
    });
    sock.on('close', () => finish(settled ? 0 : 1));
    sock.on('error', () => finish(1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Extract --profile[=...] from a raw arg list. */
function extractProfile(args: string[]): { profile?: string; rest: string[]; error?: string } {
  let profile: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      rest.push(...args.slice(i));
      break;
    }
    const eq = a.match(/^--profile=(.*)$/);
    if (eq) {
      const parsed = readProfileValue(eq[1]);
      if (parsed.error) return { rest, error: parsed.error };
      profile = parsed.profile;
      continue;
    }
    if (a === '--profile') {
      // A bare trailing --profile with no value is a user error — surface it
      // rather than silently dropping the flag and publishing under default.
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        return { rest, error: PROFILE_ERROR };
      }
      const parsed = readProfileValue(next);
      if (parsed.error) return { rest, error: parsed.error };
      profile = parsed.profile;
      i++; // consume value
      continue;
    }
    rest.push(a);
  }
  return { profile, rest };
}

function toPositionalStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

/** Project a fatal CLI error to stderr without assuming thrown values are Error instances. */
export function formatCliFatalError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

// ---------------------------------------------------------------------------
// yargs entry (Chapter 7.1) — three explicit subcommands; everything else is
// an implicit publish intent (7.1.2).
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const parsed = await yargs(hideBin(argv))
    .scriptName('pnpm-pub')
    .command(
      'start',
      'Boot the daemon and open the tray window',
      (y) => y.option('profile', { type: 'string' }),
    )
    .command('status', 'Check the running daemon and active profile')
    .command('stop', 'Gracefully stop the daemon')
    .command('version', 'Print the pnpm-pub version')
    .option('profile', { type: 'string', describe: 'Profile to use for the action' })
    .help(false)
    .version(false)
    .fail((_, _err, yargsInstance) => {
      // On any parse failure we fall back to treating the full argv as a
      // publish intent (Chapter 7.1.2 — never surface yargs errors).
      void yargsInstance;
    })
    .parseAsync();

  const parsedProfile = readProfileValue(parsed.profile);
  if (parsedProfile.error) {
    process.stderr.write(`${parsedProfile.error}\n`);
    process.exit(1);
  }

  // Explicit subcommand?
  const positional = toPositionalStrings(parsed._);
  if (positional[0] === 'start') {
    process.exit(await runStart(parsedProfile.profile));
  }
  if (positional[0] === 'status') {
    process.exit(await runStatus());
  }
  if (positional[0] === 'stop') {
    process.exit(await runStop());
  }
  if (positional[0] === 'version') {
    // pnpm-pub's own version. Note `pnpm-pub --version` is distinct: it is a
    // publish terminal intent (Chapter 7.1.2) and forwards to `pnpm publish
    // --version` (≡ `pnpm --version`), preserving muscle-memory parity.
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exit(0);
  }

  // Fallback: everything is a publish intent. We deliberately re-read the raw
  // argv (excluding any --profile) so pnpm publish flags pass through 1:1.
  const raw = hideBin(argv);
  const extracted = extractProfile(raw);
  if (extracted.error) {
    process.stderr.write(`${extracted.error}\n`);
    process.exit(1);
  }
  const { profile, rest } = extracted;
  const publishArgs = rest[0] === 'publish' ? rest.slice(1) : rest;
  if (isPublishTerminalIntent(publishArgs)) {
    process.exit(await runNativePublishTerminalIntent(publishArgs));
  }
  process.exit(await runPublish(process.cwd(), publishArgs, profile));
}

// Run when invoked as the bin entrypoint.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]!) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv).catch((err) => {
    process.stderr.write(`${formatCliFatalError(err)}\n`);
    process.exit(1);
  });
}
