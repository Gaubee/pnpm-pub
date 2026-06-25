/**
 * Minimal RFC6455 WebSocket server — no external dependency, to keep the
 * bundled daemon lean (Chapter 9). Implements just enough for our trusted
 * single-client WebUI channel: handshake, text frames, close.
 */
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

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
    private socket: net.Socket,
    private handlers: WsHandlers,
  ) {
    this.send = (data) => this.write(data);
    this.socket.on('data', (chunk) => this.consume(chunk));
    this.socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.handlers.onClose?.();
      }
    });
    this.socket.on('error', () => {
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
      if (!parsed) return;
      const { opcode, payload, consumed } = parsed;
      this.buf = this.buf.subarray(consumed);
      if (opcode === 0x8) {
        // close
        this.closed = true;
        try {
          this.socket.end();
        } catch {
          /* ignore */
        }
        this.handlers.onClose?.();
        return;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        // text or binary — treat as JSON text
        const text = payload.toString('utf8');
        try {
          const obj = JSON.parse(text);
          this.handlers.onMessage?.(obj, this.send);
        } catch {
          /* ignore non-json */
        }
      }
    }
  }

  private tryParse(): { opcode: number; payload: Buffer; consumed: number } | null {
    const b = this.buf;
    if (b.length < 2) return null;
    const b0 = b[0]!;
    const b1 = b[1]!;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      // Read as BigInt then Number (we never expect frames > 2^31).
      len = Number(b.readBigUInt64BE(2));
      offset = 10;
    }
    let mask: Buffer | null = null;
    if (masked) {
      if (b.length < offset + 4) return null;
      mask = b.subarray(offset, offset + 4);
      offset += 4;
    }
    if (b.length < offset + len) return null;
    let payload = b.subarray(offset, offset + len);
    if (mask) {
      const unmasked = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i]! ^ mask[i % 4]!;
      payload = unmasked;
    }
    return { opcode, payload, consumed: offset + len };
  }

  write(data: unknown): void {
    if (this.closed) return;
    const json = Buffer.from(JSON.stringify(data), 'utf8');
    const len = json.length;
    const header =
      len < 126
        ? Buffer.from([0x81, len])
        : len < 65536
          ? Buffer.concat([Buffer.from([0x81, 126]), Buffer.from(new Uint16Array([(len >> 8) & 0xff, len & 0xff]).buffer)])
          : Buffer.concat([Buffer.from([0x81, 127]), bigEndian64(len)]);
    // Server frames are unmasked.
    try {
      this.socket.write(Buffer.concat([header, json]));
    } catch {
      /* ignore */
    }
  }
}

function bigEndian4(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
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
 * Inspect an HTTP upgrade request and complete the WebSocket handshake if the
 * `Sec-WebSocket-Key` is present. Returns true on success.
 */
export function acceptWebSocket(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const key = req.headers['sec-websocket-key'];
  if (!key) return null;
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Random bytes used for the per-connection challenges (unused for now). */
export function nonce(): string {
  return randomBytes(16).toString('base64');
}
