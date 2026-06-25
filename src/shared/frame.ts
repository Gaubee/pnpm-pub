/**
 * Length-delimited JSON framing for the CLI <-> Daemon IPC channel.
 *
 * One JSON object per line (newline-delimited JSON). This keeps the protocol
 * trivial to debug with `tail -f` on the socket log while remaining robust
 * under partial reads.
 */
import { Buffer } from 'node:buffer';
import type { IpcFrame, IpcRequest } from './index.js';

const SEP = 0x0a; // \n

export function encodeFrame(obj: IpcRequest | IpcFrame): Buffer {
  return Buffer.from(JSON.stringify(obj) + '\n', 'utf8');
}

/**
 * A minimal incremental line-buffered reader for socket streams.
 * Feed it raw chunks via `push()` and drain complete frames via `drain()`.
 */
export class FrameReader {
  private buf = '';

  push(chunk: Buffer | string): void {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  }

  /** Yield every fully-terminated JSON frame currently buffered. */
  *drain(): Generator<IpcRequest | IpcFrame> {
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line.length === 0) continue;
      yield JSON.parse(line) as IpcRequest | IpcFrame;
    }
  }
}

export { SEP };
