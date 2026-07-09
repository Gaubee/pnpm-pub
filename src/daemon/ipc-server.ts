/**
 * IPC socket server (Chapter 5.2.1, 7.2).
 *
 * Listens on the platform named pipe / unix domain socket. Each CLI client
 * connection is line-framed (Chapter: shared/frame.ts). The daemon never
 * authorises anything over this channel — it only accepts action intents and
 * relays stdout/stderr/exit frames back to the waiting terminal.
 */
import net from "node:net";
import fs from "node:fs";
import { encodeFrame, FrameReader, isIpcCancelRequest, isIpcRequest } from "../shared/frame.js";
import type {
  IpcPublishRequest,
  IpcOidcRequest,
  IpcHandshake,
  IpcStatusFrame,
  IpcRequest,
} from "../shared/index.js";
import { socketPath, runDir, daemonLogPath } from "../shared/paths.js";
import type { PublishScheduler, PendingClient } from "./scheduler.js";

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
    if (process.platform !== "win32") {
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
      server.on("error", () => resolve(false));
      server.listen(sock, () => {
        this.server = server;
        // Chapter 3.2.1 hard requirement: chmod 600 on the socket file. We do
        // this SYNCHRONOUSLY inside the listening callback (the file now
        // exists) so the permission is in effect before any client connects —
        // there is no window where the socket is world-readable.
        if (process.platform !== "win32") {
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
    const pendingTaskIds = new Set<string>();
    let pendingCancelReason = "Publish canceled because the CLI client disconnected.";
    let cancelRequested = false;
    let requestedCancelReason: string | undefined;
    let ownerWatch: NodeJS.Timeout | undefined;
    let completedByDaemon = false;
    let socketClosed = false;
    const clearOwnerWatch = (): void => {
      if (!ownerWatch) return;
      clearInterval(ownerWatch);
      ownerWatch = undefined;
    };
    const startOwnerWatch = (pid: number | undefined): void => {
      if (!pid || ownerWatch) return;
      ownerWatch = setInterval(() => {
        if (completedByDaemon || pendingTaskIds.size === 0) {
          clearOwnerWatch();
          return;
        }
        if (isProcessAlive(pid)) return;
        cancelOwnedTasks();
      }, 250);
      ownerWatch.unref();
    };
    const makeClient = (): PendingClient => ({
      log: (stream, data) => safeWrite(socket, encodeFrame({ type: stream, data })),
      exit: (code, message) => {
        completedByDaemon = true;
        clearOwnerWatch();
        safeWrite(socket, encodeFrame({ type: "exit", code, message }));
        try {
          socket.end();
        } catch {
          /* ignore */
        }
      },
    });
    socket.on("pnpm-pub:daemon-exit", () => {
      completedByDaemon = true;
    });
    const cancelOnClientDisconnect = (): void => {
      socketClosed = true;
      if (completedByDaemon || pendingTaskIds.size === 0) return;
      for (const id of pendingTaskIds) {
        this.deps.scheduler.cancel(id, pendingCancelReason);
      }
      pendingTaskIds.clear();
    };
    const cancelOwnedTasks = (reason?: string): void => {
      cancelRequested = true;
      requestedCancelReason = reason;
      const cancelReason = reason ?? pendingCancelReason;
      if (pendingTaskIds.size === 0) return;
      for (const id of pendingTaskIds) {
        this.deps.scheduler.cancel(id, cancelReason);
      }
      pendingTaskIds.clear();
      clearOwnerWatch();
      cancelRequested = false;
      requestedCancelReason = undefined;
    };

    socket.on("data", async (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (isIpcCancelRequest(frame)) {
          cancelOwnedTasks(frame.reason);
          continue;
        }
        if (!isIpcRequest(frame)) {
          completedByDaemon = true;
          writeExit(socket, 1, "invalid IPC request");
          continue;
        }
        const task = await this.dispatch(frame, socket, () => {
          if (!pendingClient) pendingClient = makeClient();
          return pendingClient;
        });
        if (task?.kind === "owned-tasks") {
          pendingCancelReason = task.cancelReason;
          for (const id of task.ids) pendingTaskIds.add(id);
          startOwnerWatch(task.clientPid);
          if (cancelRequested && !completedByDaemon) {
            cancelOwnedTasks(requestedCancelReason);
          }
          if (socketClosed && !completedByDaemon) {
            for (const id of pendingTaskIds) {
              this.deps.scheduler.cancel(id, pendingCancelReason);
            }
            pendingTaskIds.clear();
          }
        }
      }
    });
    socket.on("error", () => {
      /* connection reset — ignore */
    });
    socket.on("end", cancelOnClientDisconnect);
    socket.on("close", cancelOnClientDisconnect);
  }

  private async dispatch(
    frame: IpcRequest,
    socket: net.Socket,
    client: () => PendingClient,
  ): Promise<
    { kind: "owned-tasks"; ids: string[]; cancelReason: string; clientPid?: number } | undefined
  > {
    // Version handshake (Chapter 7.2.1).
    if (isIpcHandshake(frame)) {
      if (frame.cliVersion !== this.deps.cliVersion) {
        // Newer CLI -> old daemon: instruct self-destruct.
        if (isNewerVersion(frame.cliVersion, this.deps.cliVersion)) {
          // Signal exit; CLI will spawn a fresh daemon.
          markDaemonExit(socket);
          writeExit(socket, 0, "daemon-outdated");
          void this.deps.onStop?.();
          return undefined;
        }
      }
      return undefined;
    }

    if (isIpcPublishRequest(frame)) {
      const event = await this.deps.scheduler.intercept(frame, client());
      return event
        ? {
            kind: "owned-tasks",
            ids: [event.id],
            cancelReason: "Publish canceled because the CLI client disconnected.",
            clientPid: frame.clientPid,
          }
        : undefined;
    }
    if (isIpcOidcRequest(frame)) {
      const events = await this.deps.scheduler.createOidcEvents(frame, client());
      return events && events.length > 0
        ? {
            kind: "owned-tasks",
            ids: events.map((event) => event.id),
            cancelReason: "OIDC canceled because the CLI client disconnected.",
            clientPid: frame.clientPid,
          }
        : undefined;
    }
    const cmd = frame.command;
    if (cmd === "status") {
      const info = this.deps.onStatus?.() ?? { active: true };
      const status: IpcStatusFrame = {
        type: "status",
        active: info.active,
        profile: info.profile,
        pid: info.pid,
      };
      safeWrite(socket, encodeFrame(status));
      markDaemonExit(socket);
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      return undefined;
    }
    if (cmd === "stop") {
      markDaemonExit(socket);
      safeWrite(socket, encodeFrame({ type: "status", active: false }));
      await this.deps.onStop?.();
      return undefined;
    }
    if (cmd === "start") {
      if (frame.profileOverride && frame.profileOverride.length > 0) {
        const applied = (await this.deps.onStart?.(frame.profileOverride)) ?? true;
        if (!applied) {
          const message = `Profile "${frame.profileOverride}" not found. Add it via the tray GUI first.`;
          markDaemonExit(socket);
          writeExit(socket, 1, message);
          try {
            socket.end();
          } catch {
            /* ignore */
          }
          return undefined;
        }
      }
      markDaemonExit(socket);
      safeWrite(socket, encodeFrame({ type: "status", active: true }));
      try {
        socket.end();
      } catch {
        /* ignore */
      }
      return undefined;
    }
    return undefined;
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
  safeWrite(socket, encodeFrame({ type: "exit", code, message }));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function markDaemonExit(socket: net.Socket): void {
  socket.emit("pnpm-pub:daemon-exit");
}

function isIpcHandshake(frame: IpcRequest): frame is IpcHandshake {
  return "cliVersion" in frame && typeof frame.cliVersion === "string";
}

function isIpcPublishRequest(frame: IpcRequest): frame is IpcPublishRequest {
  return (
    "command" in frame &&
    frame.command === "publish" &&
    typeof frame.cwd === "string" &&
    Array.isArray(frame.args) &&
    frame.args.every((arg) => typeof arg === "string") &&
    isOptionalString(frame.profileOverride)
  );
}

function isIpcOidcRequest(frame: IpcRequest): frame is IpcOidcRequest {
  return "command" in frame && frame.command === "oidc";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
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
  const [withoutBuild = ""] = version.split("+", 1);
  const [core = "", prereleaseText] = withoutBuild.split("-", 2);
  const parts = core.split(".");
  const prerelease = prereleaseText
    ? prereleaseText.split(".").filter((part) => part.length > 0)
    : [];
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
