/**
 * IPC server tests (Chapter 5.2.1, 7.1.1, 7.2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { IpcServer } from '../../src/daemon/ipc-server.js';
import type { IpcServerDeps } from '../../src/daemon/ipc-server.js';
import { PublishScheduler } from '../../src/daemon/scheduler.js';
import { DaemonStore } from '../../src/daemon/store.js';
import { FrameReader, isIpcFrame } from '../../src/shared/frame.js';
import type { IpcFrame, IpcRequest } from '../../src/shared/index.js';
import { setHomeOverride, socketPath } from '../../src/shared/paths.js';

const sandbox = path.join('/tmp', `ppipc-${process.pid}-${Date.now()}`);
const silentTimeoutMs = 50;

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(async () => {
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

async function startIpcServer(deps: IpcServerDeps): Promise<IpcServer> {
  const ipc = new IpcServer(deps);
  const started = await ipc.start();
  expect(started).toBe(true);
  return ipc;
}

async function requestFrames(
  frame: IpcRequest | IpcFrame | Record<string, unknown>,
  options: {
    done?: (frames: IpcFrame[]) => boolean;
    timeoutMs?: number;
  } = {},
): Promise<IpcFrame[]> {
  const reader = new FrameReader();
  const frames: IpcFrame[] = [];
  const timeoutMs = options.timeoutMs ?? 500;

  return new Promise<IpcFrame[]>((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection(socketPath());
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(frames);
    };
    const timer = setTimeout(finish, timeoutMs);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(frame)}\n`);
    });
    socket.on('data', (chunk) => {
      reader.push(chunk);
      for (const decoded of reader.drain()) {
        if (isIpcFrame(decoded)) frames.push(decoded);
      }
      if (options.done?.(frames)) finish();
    });
    socket.on('close', finish);
    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('IPC server request boundary', () => {
  it('Scenario: Given a malformed publish frame, When it reaches the socket, Then the daemon rejects it before creating an event', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    const scheduler = new PublishScheduler(store);

    const ipc = await startIpcServer({
      scheduler,
      cliVersion: '0.1.0',
    });
    try {
      const frames = await requestFrames(
        { command: 'publish', cwd: sandbox, args: [42] },
        { done: (frames) => frames.some((frame) => frame.type === 'exit') },
      );

      expect(frames.find((frame) => frame.type === 'exit')).toMatchObject({
        type: 'exit',
        code: 1,
        message: 'invalid IPC request',
      });
      expect(store.getEvents()).toEqual([]);
    } finally {
      await ipc.stop();
    }
  });
});

describe('IPC server start override handling', () => {
  it('Scenario: Given start --profile matches a profile, When sent over the socket, Then onStart applies it and status is active', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });
    await store.upsertProfile({ username: 'work' });

    const onStart = vi.fn(async (profileOverride?: string) => {
      if (profileOverride) {
        return store.setDefault(profileOverride);
      }
      return true;
    });

    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0',
      onStart,
      onStatus: () => ({ active: true, profile: store.getDefault(), pid: 1234 }),
    });
    try {
      const frames = await requestFrames(
        { command: 'start', profileOverride: 'work' },
        { done: (frames) => frames.some((frame) => frame.type === 'status') },
      );

      expect(onStart).toHaveBeenCalledWith('work');
      expect(store.getDefault()).toBe('work');
      expect(frames.find((frame) => frame.type === 'status')).toMatchObject({ active: true });
    } finally {
      await ipc.stop();
    }
  });

  it('Scenario: Given start --profile names no profile, When sent over the socket, Then the server exits without active status', async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: 'alice' });

    const onStart = vi.fn(async (profileOverride?: string) => {
      if (profileOverride) {
        return store.setDefault(profileOverride);
      }
      return true;
    });

    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0',
      onStart,
      onStatus: () => ({ active: true, profile: store.getDefault(), pid: 1234 }),
    });
    try {
      const frames = await requestFrames(
        { command: 'start', profileOverride: 'ghost' },
        { done: (frames) => frames.some((frame) => frame.type === 'exit') },
      );

      expect(onStart).toHaveBeenCalledWith('ghost');
      expect(store.getDefault()).toBe('alice');
      expect(frames.find((frame) => frame.type === 'exit')).toMatchObject({
        code: 1,
        message: expect.stringContaining('Profile "ghost" not found'),
      });
      expect(frames.some((frame) => frame.type === 'status')).toBe(false);
    } finally {
      await ipc.stop();
    }
  });
});

describe('IPC server version handshake', () => {
  it('Scenario: Given a newer CLI patch version, When handshake reaches the socket, Then the old daemon self-destructs', async () => {
    const store = new DaemonStore();
    await store.load();
    const onStop = vi.fn(async () => {});
    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0',
      onStop,
    });
    try {
      const frames = await requestFrames(
        { cliVersion: '0.1.1' },
        { done: (frames) => frames.some((frame) => frame.type === 'exit') },
      );

      expect(frames.find((frame) => frame.type === 'exit')).toMatchObject({
        type: 'exit',
        code: 0,
        message: 'daemon-outdated',
      });
      expect(onStop).toHaveBeenCalledOnce();
    } finally {
      await ipc.stop();
    }
  });

  it('Scenario: Given an older CLI patch version, When handshake reaches the socket, Then no daemon action is emitted', async () => {
    const store = new DaemonStore();
    await store.load();
    const onStop = vi.fn(async () => {});
    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.1',
      onStop,
    });
    try {
      const frames = await requestFrames({ cliVersion: '0.1.0' }, { timeoutMs: silentTimeoutMs });

      expect(frames).toEqual([]);
      expect(onStop).not.toHaveBeenCalled();
    } finally {
      await ipc.stop();
    }
  });

  it('Scenario: Given a release CLI and prerelease daemon, When handshake reaches the socket, Then the old daemon self-destructs', async () => {
    const store = new DaemonStore();
    await store.load();
    const onStop = vi.fn(async () => {});
    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0-beta.1',
      onStop,
    });
    try {
      const frames = await requestFrames(
        { cliVersion: '0.1.0' },
        { done: (frames) => frames.some((frame) => frame.type === 'exit') },
      );

      expect(frames.find((frame) => frame.type === 'exit')).toMatchObject({
        type: 'exit',
        code: 0,
        message: 'daemon-outdated',
      });
      expect(onStop).toHaveBeenCalledOnce();
    } finally {
      await ipc.stop();
    }
  });

  it('Scenario: Given a newer CLI prerelease identifier, When handshake reaches the socket, Then the old daemon self-destructs', async () => {
    const store = new DaemonStore();
    await store.load();
    const onStop = vi.fn(async () => {});
    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0-beta.1',
      onStop,
    });
    try {
      const frames = await requestFrames(
        { cliVersion: '0.1.0-beta.2' },
        { done: (frames) => frames.some((frame) => frame.type === 'exit') },
      );

      expect(frames.find((frame) => frame.type === 'exit')).toMatchObject({
        type: 'exit',
        code: 0,
        message: 'daemon-outdated',
      });
      expect(onStop).toHaveBeenCalledOnce();
    } finally {
      await ipc.stop();
    }
  });

  it('Scenario: Given a prerelease CLI and release daemon, When handshake reaches the socket, Then no daemon action is emitted', async () => {
    const store = new DaemonStore();
    await store.load();
    const onStop = vi.fn(async () => {});
    const ipc = await startIpcServer({
      scheduler: new PublishScheduler(store),
      cliVersion: '0.1.0',
      onStop,
    });
    try {
      const frames = await requestFrames({ cliVersion: '0.1.0-beta.2' }, { timeoutMs: silentTimeoutMs });

      expect(frames).toEqual([]);
      expect(onStop).not.toHaveBeenCalled();
    } finally {
      await ipc.stop();
    }
  });
});
