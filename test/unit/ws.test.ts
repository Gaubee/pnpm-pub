/**
 * WebSocket frame encoding tests (Chapter 5.2.3).
 *
 * Verifies that extended payload lengths are encoded in network byte order so
 * state snapshots larger than 125 bytes remain parseable by the WebUI client.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { acceptWebSocket, WebSocketConnection, type SocketLike } from '../../src/daemon/ws.js';

class SocketStub extends EventEmitter implements SocketLike {
  readonly writes: Buffer[] = [];
  ended = false;

  write(chunk: Buffer | Uint8Array | string): boolean {
    this.writes.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk));
    return true;
  }

  end(): void {
    this.ended = true;
    this.emit('close');
  }

  destroy(): void {
    this.emit('close');
  }
}

function makeSocket(): { socket: SocketLike; writes: Buffer[] } {
  const socket = new SocketStub();
  return { socket, writes: socket.writes };
}

function makeInspectableSocket(): SocketStub {
  return new SocketStub();
}

function clientFrameHeaderWithLength(length: bigint): Buffer {
  const encodedLength = Buffer.alloc(8);
  encodedLength.writeBigUInt64BE(length, 0);
  return Buffer.concat([Buffer.from([0x81, 127]), encodedLength]);
}

function clientCloseFrameHeaderWithExtendedLength(length: number): Buffer {
  const encodedLength = Buffer.alloc(2);
  encodedLength.writeUInt16BE(length, 0);
  return Buffer.concat([Buffer.from([0x88, 0x80 | 126]), encodedLength]);
}

function clientCloseFrameHeaderWithOneByteLength(): Buffer {
  return Buffer.from([0x88, 0x80 | 1]);
}

function unmaskedClientTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

function maskedClientPayload(opcode: number, payload: Buffer, fin = true, reservedBits = 0): Buffer {
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const maskedPayload = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) maskedPayload[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([
    Buffer.from([(fin ? 0x80 : 0) | reservedBits | opcode, 0x80 | payload.length]),
    mask,
    maskedPayload,
  ]);
}

function maskedClientPayloadWith16BitLength(opcode: number, payload: Buffer): Buffer {
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const length = Buffer.alloc(2);
  const maskedPayload = Buffer.alloc(payload.length);
  length.writeUInt16BE(payload.length, 0);
  for (let i = 0; i < payload.length; i++) maskedPayload[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 126]), length, mask, maskedPayload]);
}

function maskedClientFrame(opcode: number, text: string, fin = true, reservedBits = 0): Buffer {
  return maskedClientPayload(opcode, Buffer.from(text, 'utf8'), fin, reservedBits);
}

function maskedClientInvalidUtf8JsonFrame(): Buffer {
  const payload = Buffer.concat([
    Buffer.from('{"type":"ping","value":"', 'utf8'),
    Buffer.from([0x80]),
    Buffer.from('"}', 'utf8'),
  ]);
  return maskedClientPayload(0x1, payload);
}

function validUpgradeHeaders(): Record<string, string> {
  return {
    upgrade: 'websocket',
    connection: 'keep-alive, Upgrade',
    'sec-websocket-version': '13',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
  };
}

describe('WebSocketConnection.write', () => {
  it('encodes extended payload lengths using big-endian length bytes', () => {
    const { socket, writes } = makeSocket();
    const conn = new WebSocketConnection(socket, {});
    conn.write({ message: 'x'.repeat(180) });

    expect(writes).toHaveLength(1);
    const frame = writes[0]!;
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(126);

    const payloadLen = frame.readUInt16BE(2);
    const payload = frame.subarray(4).toString('utf8');
    expect(payloadLen).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(JSON.parse(payload)).toEqual({ message: 'x'.repeat(180) });
  });
});

describe('WebSocketConnection inbound frame boundary', () => {
  it('Scenario: Given an unmasked client text frame, When parsed, Then it is rejected before dispatch', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', unmaskedClientTextFrame(JSON.stringify({ type: 'ping' })));

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given an oversized 64-bit client frame length, When parsed, Then the connection closes instead of retaining impossible transport state', () => {
    const socket = makeInspectableSocket();
    let closed = 0;
    new WebSocketConnection(socket, {
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', clientFrameHeaderWithLength(1_048_577n));

    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a masked binary JSON frame, When parsed, Then it is rejected before daemon dispatch', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', maskedClientFrame(0x2, JSON.stringify({ type: 'ping' })));

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a fragmented text frame, When parsed, Then it is rejected before partial payload decoding', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', maskedClientFrame(0x1, JSON.stringify({ type: 'ping' }), false));

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given an extension-marked text frame without negotiated extensions, When parsed, Then it is rejected before daemon dispatch', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', maskedClientFrame(0x1, JSON.stringify({ type: 'ping' }), true, 0x40));

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a close frame with an extended payload length, When parsed, Then it is rejected before waiting for payload bytes', () => {
    const socket = makeInspectableSocket();
    let closed = 0;
    new WebSocketConnection(socket, {
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', clientCloseFrameHeaderWithExtendedLength(126));

    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a close frame with a one-byte payload length, When parsed, Then it is rejected before waiting for mask bytes', () => {
    const socket = makeInspectableSocket();
    let closed = 0;
    new WebSocketConnection(socket, {
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', clientCloseFrameHeaderWithOneByteLength());

    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a text frame with invalid UTF-8 inside JSON-looking bytes, When parsed, Then it is rejected before daemon dispatch', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit('data', maskedClientInvalidUtf8JsonFrame());

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });

  it('Scenario: Given a small text frame with non-minimal extended length encoding, When parsed, Then it is rejected before daemon dispatch', () => {
    const socket = makeInspectableSocket();
    const messages: unknown[] = [];
    let closed = 0;
    new WebSocketConnection(socket, {
      onMessage: (message) => {
        messages.push(message);
      },
      onClose: () => {
        closed += 1;
      },
    });

    socket.emit(
      'data',
      maskedClientPayloadWith16BitLength(0x1, Buffer.from(JSON.stringify({ type: 'ping' }), 'utf8')),
    );

    expect(messages).toEqual([]);
    expect(socket.ended).toBe(true);
    expect(closed).toBe(1);
  });
});

describe('acceptWebSocket', () => {
  it('Scenario: Given a valid client nonce, When accepting a WebSocket upgrade, Then the RFC accept value is returned', () => {
    expect(
      acceptWebSocket({
        headers: validUpgradeHeaders(),
      }),
    ).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('Scenario: Given duplicate or malformed client nonce headers, When accepting a WebSocket upgrade, Then no handshake is produced', () => {
    expect(
      acceptWebSocket({
        headers: { ...validUpgradeHeaders(), 'sec-websocket-key': ['dGhlIHNhbXBsZSBub25jZQ=='] },
      }),
    ).toBeNull();
    expect(
      acceptWebSocket({
        headers: { ...validUpgradeHeaders(), 'sec-websocket-key': 'not-a-websocket-nonce' },
      }),
    ).toBeNull();
  });

  it('Scenario: Given a nonce without WebSocket upgrade headers, When accepting a WebSocket upgrade, Then no handshake is produced', () => {
    expect(
      acceptWebSocket({
        headers: { ...validUpgradeHeaders(), upgrade: 'h2c' },
      }),
    ).toBeNull();
    expect(
      acceptWebSocket({
        headers: { ...validUpgradeHeaders(), connection: 'keep-alive' },
      }),
    ).toBeNull();
    expect(
      acceptWebSocket({
        headers: { ...validUpgradeHeaders(), 'sec-websocket-version': '12' },
      }),
    ).toBeNull();
  });
});
