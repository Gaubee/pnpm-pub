import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_PUBLISH_BRANCHES = ['master', 'main'] as const;

export type PublishGitCheckResult =
  | { ok: true }
  | { ok: false; error: string };

function readCliGitChecks(args: string[]): boolean | undefined {
  let enabled: boolean | undefined;
  for (const arg of args) {
    if (arg === '--no-git-checks') enabled = false;
    if (arg === '--git-checks') enabled = true;
    if (arg.startsWith('--git-checks=')) enabled = arg.slice('--git-checks='.length) !== 'false';
  }
  return enabled;
}

function readEnvGitChecks(): boolean | undefined {
  const value = process.env.npm_config_git_checks ?? process.env.NPM_CONFIG_GIT_CHECKS;
  return value === undefined ? undefined : parseBooleanConfigValue(value);
}

function parseBooleanConfigValue(value: string): boolean | undefined {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return undefined;
}

function parseNpmrcGitChecks(text: string): boolean | undefined {
  let value: boolean | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const match = line.match(/^git-checks\s*=\s*(.+)$/i);
    if (!match?.[1]) continue;
    const parsed = parseBooleanConfigValue(match[1]);
    if (parsed !== undefined) value = parsed;
  }
  return value;
}

async function readNearestNpmrcGitChecks(cwd: string): Promise<boolean | undefined> {
  let dir = path.resolve(cwd);
  for (;;) {
    const npmrc = path.join(dir, '.npmrc');
    try {
      const value = parseNpmrcGitChecks(await fsp.readFile(npmrc, 'utf8'));
      if (value !== undefined) return value;
    } catch {
      /* no .npmrc at this level */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function readNpmrcGitChecksFile(file: string): Promise<boolean | undefined> {
  try {
    return parseNpmrcGitChecks(await fsp.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function resolveUserNpmrcPath(): string {
  const configured = process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG;
  return configured && configured.length > 0 ? path.resolve(configured) : path.join(os.homedir(), '.npmrc');
}

async function readUserNpmrcGitChecks(): Promise<boolean | undefined> {
  return readNpmrcGitChecksFile(resolveUserNpmrcPath());
}

function resolveGlobalNpmrcPath(): string {
  const configured = process.env.npm_config_globalconfig ?? process.env.NPM_CONFIG_GLOBALCONFIG;
  if (configured && configured.length > 0) return path.resolve(configured);
  const prefix = process.env.npm_config_prefix ?? process.env.NPM_CONFIG_PREFIX ?? process.env.PREFIX;
  const resolvedPrefix = prefix && prefix.length > 0 ? path.resolve(prefix) : path.dirname(path.dirname(process.execPath));
  return path.join(resolvedPrefix, 'etc', 'npmrc');
}

async function readGlobalNpmrcGitChecks(): Promise<boolean | undefined> {
  return readNpmrcGitChecksFile(resolveGlobalNpmrcPath());
}

async function resolveGitChecksEnabled(cwd: string, args: string[]): Promise<boolean> {
  const cliValue = readCliGitChecks(args);
  if (cliValue !== undefined) return cliValue;
  const envValue = readEnvGitChecks();
  if (envValue !== undefined) return envValue;
  const projectValue = await readNearestNpmrcGitChecks(cwd);
  if (projectValue !== undefined) return projectValue;
  const userValue = await readUserNpmrcGitChecks();
  if (userValue !== undefined) return userValue;
  return (await readGlobalNpmrcGitChecks()) ?? true;
}

function resolvePublishBranchPattern(args: string[]): string {
  let pattern = DEFAULT_PUBLISH_BRANCHES.join('|');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--publish-branch') {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) pattern = next;
      continue;
    }
    if (arg.startsWith('--publish-branch=')) {
      const value = arg.slice('--publish-branch='.length);
      if (value.length > 0) pattern = value;
    }
  }
  return pattern;
}

function branchPatternAllows(pattern: string, branch: string): boolean {
  return pattern.split('|').some((entry) => entry.trim() === branch);
}

function parseAheadBehindCounts(text: string): { ahead: number; behind: number } | null {
  const parts = text.trim().split(/\s+/);
  const ahead = Number.parseInt(parts[0] ?? '', 10);
  const behind = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return null;
  return { ahead, behind };
}

async function git(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false };
  }
}

export async function checkPublishGitState(cwd: string, args: string[]): Promise<PublishGitCheckResult> {
  if (!(await resolveGitChecksEnabled(cwd, args))) return { ok: true };

  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return { ok: true };

  const status = await git(cwd, ['status', '--porcelain']);
  if (!status.ok) return { ok: true };
  if (status.stdout.trim().length > 0) {
    return {
      ok: false,
      error:
        'Unclean working tree. Commit or stash changes first. If you want to disable Git checks on publish, run again with "--no-git-checks".',
    };
  }

  const branch = await git(cwd, ['branch', '--show-current']);
  const currentBranch = branch.ok ? branch.stdout.trim() : '';
  if (!currentBranch) {
    return {
      ok: false,
      error: 'Cannot publish from a detached HEAD unless Git checks are disabled with "--no-git-checks".',
    };
  }

  const publishBranch = resolvePublishBranchPattern(args);
  if (!branchPatternAllows(publishBranch, currentBranch)) {
    return {
      ok: false,
      error: `You're on branch "${currentBranch}" but your "publish-branch" is set to "${publishBranch}". Run again with "--no-git-checks" to disable Git checks.`,
    };
  }

  return checkUpstreamHistory(cwd);
}

async function checkUpstreamHistory(cwd: string): Promise<PublishGitCheckResult> {
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok || upstream.stdout.trim().length === 0) return { ok: true };

  const counts = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!counts.ok) return { ok: true };
  const parsed = parseAheadBehindCounts(counts.stdout);
  if (!parsed) return { ok: true };
  if (parsed.behind > 0) {
    return {
      ok: false,
      error:
        'Remote history differs. Please pull changes. If you want to disable Git checks on publish, run again with "--no-git-checks".',
    };
  }
  return { ok: true };
}
