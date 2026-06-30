/**
 * `pnpm dev` supervisor.
 *
 * Owns the full local development lifecycle so Ctrl-C tears down both the live
 * Vite WebUI server and the daemon runtime. Dev mode must not build/copy the
 * WebUI; Vite is the document origin and proxies daemon API/WS traffic.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SpawnFn = typeof spawn;

interface ManagedChild {
  child: ChildProcess;
  label: string;
}

interface ChildExit {
  label: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

const IS_WINDOWS = process.platform === 'win32';

export async function main(spawnImpl: SpawnFn = spawn): Promise<void> {
  const active = new Set<ManagedChild>();
  let shuttingDown = false;
  const webuiPort = process.env.PNPM_PUB_DEV_WEBUI_PORT ?? String(await allocateRandomPort());
  const daemonPort = process.env.PNPM_PUB_DEV_DAEMON_PORT ?? String(await allocateRandomPort());
  const webviewUrl = `http://127.0.0.1:${webuiPort}/#token=__PNPM_PUB_WEB_TOKEN__`;

  const killActiveChildren = async (signal: NodeJS.Signals): Promise<void> => {
    shuttingDown = true;
    await Promise.allSettled([...active].map(({ child }) => killChild(child, signal)));
  };

  const onSignal = (signal: NodeJS.Signals) => {
    void killActiveChildren(signal);
  };

  process.once('exit', () => {
    for (const { child } of active) {
      void terminateChild(child, 'SIGTERM');
    }
  });
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const webui = spawnManaged(
      spawnImpl,
      active,
      'pnpm',
      [
        '--dir',
        'webui',
        'exec',
        'vite',
        'dev',
        '--host',
        '127.0.0.1',
        '--port',
        webuiPort,
        '--strictPort',
      ],
      { PNPM_PUB_DEV_DAEMON_PORT: daemonPort },
    );
    if (shuttingDown) return;

    if (shuttingDown) return;
    // Run the daemon via bun (not tsx). tsx compiles to CJS whose __dirname /
    // require semantics differ from the ESM runtime, which made the keytar
    // native binding and keychain reads silently fail in dev. bun runs TS as
    // ESM natively, matching the bundled (production) runtime.
    const daemon = spawnManaged(
      spawnImpl,
      active,
      'bun',
      ['run', 'src/daemon/dev.ts'],
      {
        PNPM_PUB_DEV_DAEMON_PORT: daemonPort,
        PNPM_PUB_DEV_WEBVIEW_URL: webviewUrl,
      },
    );
    const exit = await waitForFirstChildExit(webui, daemon);
    if (!shuttingDown) {
      console.error(
        `[dev] child exited: ${exit.label} code=${String(exit.code)} signal=${String(exit.signal)}; stopping remaining dev children`,
      );
    }
    if (!shuttingDown && exit.code !== 0 && exit.code !== null) {
      process.exitCode = exit.code;
    }
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await killActiveChildren('SIGINT');
  }
}

function spawnManaged(
  spawnImpl: SpawnFn,
  active: Set<ManagedChild>,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): ManagedChild {
  const child = spawnImpl(command, [...args], {
    stdio: 'inherit',
    detached: !IS_WINDOWS,
    env: {
      ...process.env,
      ...env,
      PNPM_PUB_DEV_SUPERVISOR_PID: String(process.pid),
    },
  });
  const managed = { child, label: `${command} ${args.join(' ')}` };
  active.add(managed);
  const clear = () => active.delete(managed);
  child.once('exit', (code, signal) => {
    console.error(`[dev] child exit: ${managed.label} code=${String(code)} signal=${String(signal)}`);
    clear();
  });
  child.once('close', (code, signal) => {
    console.error(`[dev] child close: ${managed.label} code=${String(code)} signal=${String(signal)}`);
    clear();
  });
  child.once('error', clear);
  return managed;
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.killed) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKill);
      clearTimeout(giveUp);
      resolve();
    };
    const forceKill = setTimeout(() => {
      void terminateChild(child, 'SIGKILL').catch(finish);
    }, 2_000);
    const giveUp = setTimeout(finish, 5_000);
    void once(child, 'exit').then(finish).catch(finish);
    void once(child, 'close').then(finish).catch(finish);
    void terminateChild(child, signal).catch(finish);
  });
}

function waitForChildExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

function waitForFirstChildExit(...children: ManagedChild[]): Promise<ChildExit> {
  return Promise.race(
    children.map(({ child, label }) => waitForChildExit(child).then((exit) => ({ label, ...exit }))),
  );
}

function allocateRandomPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function terminateChild(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.pid == null) {
    child.kill(signal);
    return;
  }
  if (!IS_WINDOWS) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* best effort */
  }
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ESRCH';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((err: unknown) => {
    console.error('[dev] fatal:', err);
    process.exit(1);
  });
}
