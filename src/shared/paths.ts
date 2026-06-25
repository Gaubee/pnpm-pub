/**
 * Application paths — the canonical `~/.pnpm-pub` layout (Chapter 4.3 / 5.1).
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { APP_DIR_NAME, PROFILES_FILE, WORKSPACES_FILE } from './index.js';

let homeOverride: string | null = null;

/** Override the home dir — used by tests to isolate state. */
export function setHomeOverride(home: string | null): void {
  homeOverride = home;
}

/**
 * Resolved home directory. Resolution order:
 *   1. in-process override (tests / dev runner)
 *   2. PNPM_PUB_HOME env var (so a spawned CLI process agrees with the daemon
 *      that launched it — the override above is process-local)
 *   3. os.homedir()
 */
export function homeDir(): string {
  if (homeOverride) return homeOverride;
  const env = process.env.PNPM_PUB_HOME;
  if (env && env.length > 0) return env;
  return os.homedir();
}

/** ~/.pnpm-pub */
export function appDir(): string {
  return path.join(homeDir(), APP_DIR_NAME);
}

/** ~/.pnpm-pub/profiles.json */
export function profilesPath(): string {
  return path.join(appDir(), PROFILES_FILE);
}

/** ~/.pnpm-pub/workspaces.json */
export function workspacesPath(): string {
  return path.join(appDir(), WORKSPACES_FILE);
}

/** ~/.pnpm-pub/run/pnpm-pub.sock (macOS) — see socketPath(). */
export function runDir(): string {
  return path.join(appDir(), 'run');
}

/**
 * IPC socket path (Chapter 3.2.1).
 *  - macOS / linux: Unix Domain Socket at ~/.pnpm-pub/run/pnpm-pub.sock
 *  - Windows: Named Pipe at \\.\pipe\pnpm-pub-sock
 */
export function socketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\pnpm-pub-sock';
  }
  return path.join(runDir(), 'pnpm-pub.sock');
}

/** ~/.pnpm-pub/.cache/avatars */
export function avatarCacheDir(): string {
  return path.join(appDir(), '.cache', 'avatars');
}

/** ~/.pnpm-pub/logs */
export function logsDir(): string {
  return path.join(appDir(), 'logs');
}

/** ~/.pnpm-pub/logs/daemon.log */
export function daemonLogPath(): string {
  return path.join(logsDir(), 'daemon.log');
}

/** Ensure the application directory tree exists. */
export function ensureAppDirs(): void {
  for (const dir of [appDir(), runDir(), avatarCacheDir(), logsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
