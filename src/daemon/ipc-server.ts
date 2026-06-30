/**
 * IPC socket server (Chapter 5.2.1, 7.2).
 *
 * Listens on the platform named pipe / unix domain socket. Each CLI client
 * connection is line-framed (Chapter: shared/frame.ts). The daemon never
 * authorises anything over this channel — it only accepts action intents and
 * relays stdout/stderr/exit frames back to the waiting terminal.
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { encodeFrame, FrameReader, isIpcRequest } from '../shared/frame.js';
import type {
  IpcPublishRequest,
  IpcHandshake,
  IpcStatusFrame,
  IpcRequest,
} from '../shared/index.js';
import { socketPath, runDir, daemonLogPath } from '../shared/paths.js';
import type { PublishScheduler, PendingClient } from './scheduler.js';

export interface IpcServerDeps {
  scheduler: PublishScheduler;
  cliVersion: string;
  onStatus?: () => { active: boolean; profile?: string; pid?: number };
  onStop?: () => Promise<void>;
  onSpawnRequest?: () => void;
  /** Apply a `start --profile` override to set the default identity (7.1.1). */
  onStart?: (profileOverride?: string) => Promise<boolean>;
}

export class IpcServer {
  private server?: net.Server;

  constructor(private deps: IpcServerDeps) {}

  /** Bind the single-instance socket (Chapter 5.1.3). Returns false if held. */
  async start(): Promise<boolean> {
    const sock = socketPath();
    // Ensure the run dir exists (unix socket parent).
    const dir = runDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
    // Restrict the run directory to the current user BEFORE the socket is
    // created, so no other user can race in (Chapter 3.2.1).
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        /* best effort */
      }
    }
    // Remove any stale socket file before binding.
    try {
      fs.unlinkSync(sock);
    } catch {
      /* not present */
    }

    return new Promise<boolean>((resolve) => {
      const server = net.createServer((socket) => this.handle(socket));
      server.on('error', () => resolve(false));
      server.listen(sock, () => {
        this.server = server;
        // Chapter 3.2.1 hard requirement: chmod 600 on the socket file. We do
        // this SYNCHRONOUSLY inside the listening callback (the file now
        // exists) so the permission is in effect before any client connects —
        // there is no window where the socket is world-readable.
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(sock, 0o600);
          } catch {
            /* best effort */
          }
        }
        resolve(true);
      });
    });
  }

  private handle(socket: net.Socket): void {
    const reader = new FrameReader();
    let pendingClient: PendingClient | null = null;
    const makeClient = (): PendingClient => ({
      log: (stream, data) => safeWrite(socket, encodeFrame({ type: stream, data })),
      exit: (code, message) => {
        safeWrite(socket, encodeFrame({ type: 'exit', code, message }));
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      },
    });

    socket.on('data', async (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcRequest(frame)) {
          writeExit(socket, 1, 'invalid IPC request');
          continue;
        }
        await this.dispatch(frame, socket, () => {
          if (!pendingClient) pendingClient = makeClient();
          return pendingClient;
        });
      }
    });
    socket.on('error', () => {
      /* connection reset — ignore */
    });
  }

  private async dispatch(
    frame: IpcRequest,
    socket: net.Socket,
    client: () => PendingClient,
  ): Promise<void> {
    // Version handshake (Chapter 7.2.1).
    if (isIpcHandshake(frame)) {
      if (frame.cliVersion !== this.deps.cliVersion) {
        // Newer CLI -> old daemon: instruct self-destruct.
        if (isNewerVersion(frame.cliVersion, this.deps.cliVersion)) {
          // Signal exit; CLI will spawn a fresh daemon.
          writeExit(socket, 0, 'daemon-outdated');
          this.deps.onStop?.();
          return;
        }
      }
      return;
    }

    if (isIpcPublishRequest(frame)) {
      await this.deps.scheduler.intercept(frame, client());
      return;
    }
    const cmd = frame.command;
    if (cmd === 'status') {
      const info = this.deps.onStatus?.() ?? { active: true };
      const status: IpcStatusFrame = {
        type: 'status',
        active: info.active,
        profile: info.profile,
        pid: info.pid,
      };
      safeWrite(socket, encodeFrame(status));
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      return;
    }
    if (cmd === 'stop') {
      safeWrite(socket, encodeFrame({ type: 'status', active: false }));
      await this.deps.onStop?.();
      return;
    }
    if (cmd === 'start') {
      if (frame.profileOverride && frame.profileOverride.length > 0) {
        const applied = (await this.deps.onStart?.(frame.profileOverride)) ?? true;
        if (!applied) {
          const message = `Profile "${frame.profileOverride}" not found. Add it via the tray GUI first.`;
          writeExit(socket, 1, message);
          try {
            socket.end();
          } catch {
            /* ignore */
          }
          return;
        }
      }
      safeWrite(socket, encodeFrame({ type: 'status', active: true }));
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      return;
    }
    // Unknown management command.
    writeExit(socket, 1, `unknown command: ${cmd}`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }
}

function safeWrite(socket: net.Socket, buf: Uint8Array): void {
  try {
    socket.write(buf);
  } catch {
    /* client gone */
  }
}

function writeExit(socket: net.Socket, code: number, message: string): void {
  safeWrite(socket, encodeFrame({ type: 'exit', code, message }));
}

function isIpcHandshake(frame: IpcRequest): frame is IpcHandshake {
  return 'cliVersion' in frame && typeof frame.cliVersion === 'string';
}

function isIpcPublishRequest(frame: IpcRequest): frame is IpcPublishRequest {
  return (
    'command' in frame &&
    frame.command === 'publish' &&
    typeof frame.cwd === 'string' &&
    Array.isArray(frame.args) &&
    frame.args.every((arg) => typeof arg === 'string') &&
    isOptionalString(frame.profileOverride)
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseSemver(candidate);
  const cur = parseSemver(current);
  for (let i = 0; i < next.core.length; i++) {
    if (next.core[i]! > cur.core[i]!) return true;
    if (next.core[i]! < cur.core[i]!) return false;
  }
  return comparePrerelease(next.prerelease, cur.prerelease) > 0;
}

interface ParsedSemver {
  core: [number, number, number];
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver {
  const [withoutBuild = ''] = version.split('+', 1);
  const [core = '', prereleaseText] = withoutBuild.split('-', 2);
  const parts = core.split('.');
  const prerelease = prereleaseText ? prereleaseText.split('.').filter((part) => part.length > 0) : [];
  return {
    core: [readVersionPart(parts[0]), readVersionPart(parts[1]), readVersionPart(parts[2])],
    prerelease,
  };
}

function comparePrerelease(next: string[], current: string[]): number {
  if (next.length === 0 && current.length === 0) return 0;
  if (next.length === 0) return 1;
  if (current.length === 0) return -1;
  const length = Math.max(next.length, current.length);
  for (let i = 0; i < length; i++) {
    const left = next[i];
    const right = current[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const partOrder = comparePrereleasePart(left, right);
    if (partOrder !== 0) return partOrder;
  }
  return 0;
}

function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = parseNumericIdentifier(left);
  const rightNumber = parseNumericIdentifier(right);
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}

function parseNumericIdentifier(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readVersionPart(part: string | undefined): number {
  if (!part) return 0;
  const value = Number(part);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export { daemonLogPath };
