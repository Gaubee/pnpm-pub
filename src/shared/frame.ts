/**
 * Length-delimited JSON framing for the CLI <-> Daemon IPC channel.
 *
 * One JSON object per line (newline-delimited JSON). This keeps the protocol
 * trivial to debug with `tail -f` on the socket log while remaining robust
 * under partial reads.
 */
import { Buffer } from "node:buffer";
import type { IpcFrame, IpcRequest } from "./index.js";

const SEP = 0x0a; // \n

export function encodeFrame(obj: IpcRequest | IpcFrame): Buffer {
  return Buffer.from(JSON.stringify(obj) + "\n", "utf8");
}

/**
 * A minimal incremental line-buffered reader for socket streams.
 * Feed it raw chunks via `push()` and drain complete frames via `drain()`.
 */
export class FrameReader {
  private buf = "";

  push(chunk: Buffer | string): void {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }

  /** Yield every fully-terminated JSON frame currently buffered. */
  *drain(): Generator<unknown> {
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line.length === 0) continue;
      yield parseJsonLine(line);
    }
  }
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

export function isIpcRequest(frame: unknown): frame is IpcRequest {
  return isIpcHandshake(frame) || isIpcPublishRequest(frame) || isIpcManagementRequest(frame);
}

export function isIpcFrame(frame: unknown): frame is IpcFrame {
  return isIpcLogFrame(frame) || isIpcExitFrame(frame) || isIpcStatusFrame(frame);
}

function isIpcHandshake(frame: unknown): frame is Extract<IpcRequest, { cliVersion: string }> {
  return isRecord(frame) && typeof frame.cliVersion === "string";
}

function isIpcPublishRequest(frame: unknown): frame is Extract<IpcRequest, { command: "publish" }> {
  return (
    isRecord(frame) &&
    frame.command === "publish" &&
    typeof frame.cwd === "string" &&
    Array.isArray(frame.args) &&
    frame.args.every((arg) => typeof arg === "string") &&
    isOptionalString(frame.profileOverride)
  );
}

function isIpcManagementRequest(
  frame: unknown,
): frame is Extract<IpcRequest, { command: "start" | "status" | "stop" }> {
  return (
    isRecord(frame) &&
    (frame.command === "start" || frame.command === "status" || frame.command === "stop") &&
    isOptionalString(frame.profileOverride)
  );
}

function isIpcLogFrame(frame: unknown): frame is Extract<IpcFrame, { type: "stdout" | "stderr" }> {
  return (
    isRecord(frame) &&
    (frame.type === "stdout" || frame.type === "stderr") &&
    typeof frame.data === "string"
  );
}

function isIpcExitFrame(frame: unknown): frame is Extract<IpcFrame, { type: "exit" }> {
  return (
    isRecord(frame) &&
    frame.type === "exit" &&
    typeof frame.code === "number" &&
    isOptionalString(frame.message)
  );
}

function isIpcStatusFrame(frame: unknown): frame is Extract<IpcFrame, { type: "status" }> {
  return (
    isRecord(frame) &&
    frame.type === "status" &&
    typeof frame.active === "boolean" &&
    isOptionalString(frame.profile) &&
    (frame.pid === undefined || typeof frame.pid === "number")
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { SEP };
