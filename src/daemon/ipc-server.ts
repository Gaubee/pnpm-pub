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
import { encodeFrame, FrameReader } from '../shared/frame.js';
import type {
  IpcFrame,
  IpcRequest,
  IpcPublishRequest,
  IpcManagementRequest,
  IpcHandshake,
  IpcStatusFrame,
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
  onStart?: (profileOverride?: string) => Promise<void>;
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
      log: (stream, data) => safeWrite(socket, encodeFrame({ type: stream, data } as IpcFrame)),
      exit: (code, message) => {
        safeWrite(socket, encodeFrame({ type: 'exit', code, message } as IpcFrame));
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
        await this.dispatch(frame as IpcRequest, socket, () => {
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
    if ((frame as IpcHandshake).cliVersion !== undefined) {
      const hs = frame as IpcHandshake;
      if (hs.cliVersion !== this.deps.cliVersion) {
        // Newer CLI -> old daemon: instruct self-destruct.
        const [curMajor, curMinor] = this.deps.cliVersion.split('.').map(Number);
        const [newMajor, newMinor] = hs.cliVersion.split('.').map(Number);
        if (
          (newMajor ?? 0) > (curMajor ?? 0) ||
          ((newMajor ?? 0) === (curMajor ?? 0) && (newMinor ?? 0) > (curMinor ?? 0))
        ) {
          // Signal exit; CLI will spawn a fresh daemon.
          safeWrite(socket, encodeFrame({ type: 'exit', code: 0, message: 'daemon-outdated' } as IpcFrame));
          this.deps.onStop?.();
          return;
        }
      }
      return;
    }

    const cmd = (frame as { command?: string }).command;
    if (cmd === 'publish') {
      await this.deps.scheduler.intercept(frame as IpcPublishRequest, client());
      return;
    }
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
      safeWrite(socket, encodeFrame({ type: 'status', active: false } as IpcStatusFrame));
      await this.deps.onStop?.();
      return;
    }
    if (cmd === 'start') {
      const req = frame as { profileOverride?: string };
      if (req.profileOverride && req.profileOverride.length > 0) {
        await this.deps.onStart?.(req.profileOverride);
      }
      safeWrite(socket, encodeFrame({ type: 'status', active: true } as IpcStatusFrame));
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      return;
    }
    // Unknown management command.
    safeWrite(socket, encodeFrame({ type: 'exit', code: 1, message: `unknown command: ${cmd}` } as IpcFrame));
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

export { daemonLogPath };
