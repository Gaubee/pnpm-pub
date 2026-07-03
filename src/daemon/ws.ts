/**
 * Minimal RFC6455 WebSocket server — no external dependency, to keep the
 * bundled daemon lean (Chapter 9). Implements just enough for our trusted
 * single-client WebUI channel: handshake, text frames, close.
 */
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CLIENT_FRAME_BYTES = 1024 * 1024;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type ParsedFrame =
  | { status: "frame"; opcode: number; payload: Buffer; consumed: number }
  | { status: "incomplete" }
  | { status: "invalid" };

export interface SocketLike {
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "error", listener: () => void): this;
  end(): void;
  destroy(): void;
  write(chunk: Buffer | Uint8Array | string): boolean;
}

export interface WsHandlers {
  onOpen?: (send: (data: unknown) => void) => void;
  onMessage?: (data: unknown, send: (data: unknown) => void) => void;
  onClose?: () => void;
}

export class WebSocketConnection {
  private buf = Buffer.alloc(0);
  private closed = false;
  private readonly send: (data: unknown) => void;

  constructor(
    private socket: SocketLike,
    private handlers: WsHandlers,
  ) {
    this.send = (data) => this.write(data);
    this.socket.on("data", (chunk) => this.consume(chunk));
    this.socket.on("close", () => {
      if (!this.closed) {
        this.closed = true;
        this.handlers.onClose?.();
      }
    });
    this.socket.on("error", () => {
      /* swallow */
    });
  }

  /** Called by the HTTP server once the handshake completes. */
  ready(): void {
    this.handlers.onOpen?.(this.send);
  }

  private consume(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const parsed = this.tryParse();
      if (parsed.status === "incomplete") return;
      if (parsed.status === "invalid") {
        this.close();
        return;
      }
      const { opcode, payload, consumed } = parsed;
      this.buf = this.buf.subarray(consumed);
      if (opcode === 0x8) {
        // close
        this.close();
        return;
      }
      if (opcode === 0x1) {
        const text = decodeTextPayload(payload);
        if (text === null) {
          this.close();
          return;
        }
        try {
          const obj = JSON.parse(text);
          this.handlers.onMessage?.(obj, this.send);
        } catch {
          /* ignore non-json */
        }
      }
    }
  }

  private tryParse(): ParsedFrame {
    const b = this.buf;
    if (b.length < 2) return { status: "incomplete" };
    const b0 = b[0]!;
    const b1 = b[1]!;
    const fin = (b0 & 0x80) !== 0;
    const reserved = (b0 & 0x70) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    if (!fin) return { status: "invalid" };
    if (reserved) return { status: "invalid" };
    if (opcode !== 0x1 && opcode !== 0x8) return { status: "invalid" };
    if (!masked) return { status: "invalid" };
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return { status: "incomplete" };
      len = b.readUInt16BE(2);
      if (len < 126) return { status: "invalid" };
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return { status: "incomplete" };
      const wireLength = b.readBigUInt64BE(2);
      if (wireLength > BigInt(MAX_CLIENT_FRAME_BYTES)) return { status: "invalid" };
      if (wireLength < 65536n) return { status: "invalid" };
      len = Number(wireLength);
      offset = 10;
    }
    if (opcode === 0x8 && (len === 1 || len > 125)) return { status: "invalid" };
    if (len > MAX_CLIENT_FRAME_BYTES) return { status: "invalid" };
    let mask: Buffer | null = null;
    if (masked) {
      if (b.length < offset + 4) return { status: "incomplete" };
      mask = b.subarray(offset, offset + 4);
      offset += 4;
    }
    if (b.length < offset + len) return { status: "incomplete" };
    let payload = b.subarray(offset, offset + len);
    if (mask) {
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i]! ^ mask[i % 4]!;
      payload = unmasked;
    }
    return { status: "frame", opcode, payload, consumed: offset + len };
  }

  write(data: unknown): void {
    if (this.closed) return;
    const json = Buffer.from(JSON.stringify(data), "utf8");
    const len = json.length;
    const header =
      len < 126
        ? Buffer.from([0x81, len])
        : len < 65536
          ? Buffer.concat([Buffer.from([0x81, 126]), bigEndian16(len)])
          : Buffer.concat([Buffer.from([0x81, 127]), bigEndian64(len)]);
    // Server frames are unmasked.
    try {
      this.socket.write(Buffer.concat([header, json]));
    } catch {
      /* ignore */
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
    this.handlers.onClose?.();
  }
}

function decodeTextPayload(payload: Buffer): string | null {
  try {
    return textDecoder.decode(payload);
  } catch {
    return null;
  }
}

function bigEndian4(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function bigEndian16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function bigEndian8(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n), 0);
  return b;
}

function bigEndian64(n: number): Buffer {
  return bigEndian8(n);
}

export { bigEndian4, bigEndian8 };

/**
 * Inspect an HTTP upgrade request and complete the WebSocket handshake when
 * `Sec-WebSocket-Key` is a single 16-byte base64 client nonce.
 */
export function acceptWebSocket(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const { headers } = req;
  if (!isHeaderValue(headers.upgrade, "websocket")) return null;
  if (!hasHeaderToken(headers.connection, "upgrade")) return null;
  if (!isHeaderValue(headers["sec-websocket-version"], "13")) return null;
  const key = headers["sec-websocket-key"];
  if (!isClientWebSocketKey(key)) return null;
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

function isHeaderValue(value: string | string[] | undefined, expected: string): boolean {
  return typeof value === "string" && value.toLowerCase() === expected;
}

function hasHeaderToken(value: string | string[] | undefined, token: string): boolean {
  if (typeof value !== "string") return false;
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(token);
}

function isClientWebSocketKey(value: string | string[] | undefined): value is string {
  if (typeof value !== "string") return false;
  if (value.trim() !== value) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, "base64").length === 16;
}

/** Random bytes used for the per-connection challenges (unused for now). */
export function nonce(): string {
  return randomBytes(16).toString("base64");
}
