/**
 * Application update service.
 *
 * The daemon owns every update fact: package-registry result, persistent check
 * cadence, and the verified global package-manager owner. The WebUI receives a
 * snapshot projection and can only request a fresh check or an explicit install.
 */
import { execFile, type ExecFileOptions } from "node:child_process";
import { existsSync, promises as fsp, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import type { AppUpdateCache, AppUpdateManager, AppUpdateOwner, AppUpdateSnapshot } from "../shared/index.js";
import { AppUpdateCacheSchema } from "../shared/schemas.js";
import { appUpdatePath } from "../shared/paths.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "pnpm-pub";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const SUCCESS_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILURE_INTERVAL_MS = 60 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface UpdateProcess {
  execFile(command: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string }>;
}

export interface AppUpdateServiceOptions {
  currentVersion: string;
  daemonEntry?: string;
  packageRoot?: string;
  now?: () => number;
  process?: UpdateProcess;
  fetch?: typeof globalThis.fetch;
  cachePath?: string;
  resolveCommandPath?: (command: string) => Promise<string | null>;
  onSnapshot?: (snapshot: AppUpdateSnapshot) => void;
  log?: (line: string) => void;
}

export interface AppUpdateWorkerRequest {
  manager: Exclude<AppUpdateManager, "unknown">;
  executable: string;
  packageRoot: string;
  expectedVersion: string;
  daemonPid: number;
  daemonEntry: string;
  nodePath: string;
  env: NodeJS.ProcessEnv;
}

/** Stable manager command adapters. No shell strings are constructed. */
export function updateCommand(manager: Exclude<AppUpdateManager, "unknown">): string[] {
  switch (manager) {
    case "npm":
      return ["install", "--global", `${PACKAGE_NAME}@latest`];
    case "pnpm":
      return ["add", "--global", `${PACKAGE_NAME}@latest`];
    case "yarn":
      return ["global", "add", `${PACKAGE_NAME}@latest`];
    case "bun":
      return ["add", "--global", `${PACKAGE_NAME}@latest`];
    case "volta":
      return ["install", `${PACKAGE_NAME}@latest`];
    case "vp":
      return ["add", "--global", `${PACKAGE_NAME}@latest`];
  }
}

export class AppUpdateService {
  private readonly now: () => number;
  private readonly command: UpdateProcess;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly cachePath: string;
  private readonly packageRoot: string;
  private readonly resolveCommandPath: (command: string) => Promise<string | null>;
  private snapshot: AppUpdateSnapshot;
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<AppUpdateSnapshot> | null = null;

  constructor(private readonly options: AppUpdateServiceOptions) {
    this.now = options.now ?? Date.now;
    this.command = options.process ?? { execFile: execFileAsync };
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.cachePath = options.cachePath ?? appUpdatePath();
    this.packageRoot = canonicalPath(options.packageRoot ?? packageRootFromModule());
    this.resolveCommandPath = options.resolveCommandPath ?? resolveExecutablePath;
    this.snapshot = emptySnapshot(options.currentVersion);
  }

  async load(): Promise<AppUpdateSnapshot> {
    const cached = await readCache(this.cachePath);
    if (cached && cached.currentVersion === this.options.currentVersion) {
      this.snapshot = {
        currentVersion: cached.currentVersion,
        runtimeVersions: cached.runtimeVersions,
        latestVersion: cached.latestVersion,
        status: cached.latestVersion && compareVersions(cached.latestVersion, cached.currentVersion) > 0 ? "available" : "idle",
        owner: cached.owner,
        lastCheckedAt: cached.lastCheckedAt,
        nextCheckAt: cached.nextCheckAt,
        error: cached.error,
      };
    }
    this.emit();
    return this.getSnapshot();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.checkWhenDue(), SCHEDULER_INTERVAL_MS);
    void this.checkWhenDue();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot(): AppUpdateSnapshot {
    return structuredClone(this.snapshot);
  }

  async checkWhenDue(): Promise<AppUpdateSnapshot> {
    const dueAt = this.snapshot.nextCheckAt;
    if (dueAt !== null && this.now() < dueAt) return this.getSnapshot();
    return this.check();
  }

  async check(): Promise<AppUpdateSnapshot> {
    if (this.checking) return this.checking;
    this.checking = this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async runCheck(): Promise<AppUpdateSnapshot> {
    this.snapshot = { ...this.snapshot, status: "checking", error: null };
    this.emit();
    try {
      const [latestVersion, owner, runtimeVersions] = await Promise.all([
        this.fetchLatestVersion(),
        this.resolveOwner(),
        this.resolveRuntimeVersions(),
      ]);
      const checkedAt = this.now();
      this.snapshot = {
        currentVersion: this.options.currentVersion,
        runtimeVersions,
        latestVersion,
        status: compareVersions(latestVersion, this.options.currentVersion) > 0 ? "available" : "up-to-date",
        owner,
        lastCheckedAt: checkedAt,
        nextCheckAt: checkedAt + SUCCESS_INTERVAL_MS,
        error: null,
      };
      await this.persist();
    } catch (error) {
      const checkedAt = this.now();
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        lastCheckedAt: checkedAt,
        nextCheckAt: checkedAt + FAILURE_INTERVAL_MS,
        error: errorMessage(error),
      };
      await this.persist();
    }
    this.emit();
    return this.getSnapshot();
  }

  async prepareInstall(): Promise<AppUpdateWorkerRequest | { error: string }> {
    const { latestVersion, owner } = this.snapshot;
    if (!latestVersion || compareVersions(latestVersion, this.options.currentVersion) <= 0) {
      return { error: "pnpm-pub is already up to date." };
    }
    if (!owner.canUpdate || owner.manager === "unknown" || !owner.packageRoot) {
      return { error: owner.reason ?? "The global package manager for pnpm-pub could not be verified." };
    }
    const executable = await this.resolveCommandPath(owner.manager);
    if (!executable) return { error: `The ${owner.manager} executable is no longer available.` };
    this.snapshot = { ...this.snapshot, status: "installing", error: null };
    this.emit();
    return {
      manager: owner.manager,
      executable,
      packageRoot: owner.packageRoot,
      expectedVersion: latestVersion,
      daemonPid: process.pid,
      daemonEntry: this.options.daemonEntry ?? process.argv[1] ?? "",
      nodePath: process.execPath,
      env: process.env,
    };
  }

  private async fetchLatestVersion(): Promise<string> {
    const response = await this.fetchImpl(REGISTRY_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}.`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.version !== "string" || !isSemver(payload.version)) {
      throw new Error("npm registry returned an invalid latest version.");
    }
    return payload.version;
  }

  private async resolveRuntimeVersions(): Promise<{ npm: string | null; pnpm: string | null }> {
    const versionFor = async (command: "npm" | "pnpm"): Promise<string | null> => {
      const executable = await this.resolveCommandPath(command);
      if (!executable) return null;
      try {
        const result = await this.command.execFile(executable, ["--version"], {
          timeout: 3_000,
          windowsHide: true,
        });
        const version = result.stdout.trim();
        return version.length > 0 ? version : null;
      } catch {
        return null;
      }
    };
    const [npm, pnpm] = await Promise.all([versionFor("npm"), versionFor("pnpm")]);
    return { npm, pnpm };
  }

  private async resolveOwner(): Promise<AppUpdateOwner> {
    const probes: readonly { manager: Exclude<AppUpdateManager, "unknown">; args: string[] }[] = [
      { manager: "npm", args: ["root", "--global"] },
      { manager: "pnpm", args: ["root", "--global"] },
      { manager: "yarn", args: ["global", "dir"] },
      { manager: "bun", args: ["pm", "bin", "--global"] },
      { manager: "volta", args: ["which", PACKAGE_NAME] },
      { manager: "vp", args: ["which", PACKAGE_NAME] },
    ];
    for (const probe of probes) {
      const executable = await this.resolveCommandPath(probe.manager);
      if (!executable) continue;
      try {
        const result = await this.command.execFile(executable, probe.args, { timeout: 5_000, windowsHide: true });
        const resolved = resolvePackageRoot(probe.manager, result.stdout);
        if (resolved && samePath(resolved, this.packageRoot)) {
          return { manager: probe.manager, packageRoot: resolved, canUpdate: true, reason: null };
        }
      } catch {
        // A manager that cannot prove ownership is deliberately not an updater.
      }
    }
    return {
      manager: "unknown",
      packageRoot: this.packageRoot,
      canUpdate: false,
      reason: "pnpm-pub is not installed in a verified global package-manager location.",
    };
  }

  private async persist(): Promise<void> {
    const cache: AppUpdateCache = {
      currentVersion: this.snapshot.currentVersion,
      runtimeVersions: this.snapshot.runtimeVersions,
      latestVersion: this.snapshot.latestVersion,
      owner: this.snapshot.owner,
      lastCheckedAt: this.snapshot.lastCheckedAt,
      nextCheckAt: this.snapshot.nextCheckAt,
      error: this.snapshot.error,
    };
    const temporary = `${this.cachePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fsp.writeFile(temporary, JSON.stringify(cache, null, 2), "utf8");
    await fsp.rename(temporary, this.cachePath);
  }

  private emit(): void {
    this.options.onSnapshot?.(this.getSnapshot());
  }
}

function emptySnapshot(currentVersion: string): AppUpdateSnapshot {
  return {
    currentVersion,
    runtimeVersions: { npm: null, pnpm: null },
    latestVersion: null,
    status: "idle",
    owner: { manager: "unknown", packageRoot: null, canUpdate: false, reason: null },
    lastCheckedAt: null,
    nextCheckAt: null,
    error: null,
  };
}

async function readCache(cachePath: string): Promise<AppUpdateCache | null> {
  try {
    const source: unknown = JSON.parse(await fsp.readFile(cachePath, "utf8"));
    const parsed = AppUpdateCacheSchema.safeParse(source);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function packageRootFromModule(): string {
  let cursor = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = path.join(cursor, "package.json");
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (isRecord(parsed) && parsed.name === PACKAGE_NAME) return cursor;
    } catch {
      // The bundled entry may be in dist/; walk up to the installed package root.
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return process.cwd();
    cursor = parent;
  }
}

function resolvePackageRoot(manager: Exclude<AppUpdateManager, "unknown">, stdout: string): string | null {
  const value = stdout.trim().split(/\r?\n/)[0]?.trim();
  if (!value) return null;
  if (manager === "npm" || manager === "pnpm") return path.join(value, PACKAGE_NAME);
  if (manager === "yarn") return path.join(value, "node_modules", PACKAGE_NAME);
  // `bun pm bin --global` reports ~/.bun/bin while packages live at
  // ~/.bun/install/global/node_modules. The bin path is still the reliable
  // anchor because BUN_INSTALL may relocate that whole root.
  if (manager === "bun") return path.resolve(value, "..", "install", "global", "node_modules", PACKAGE_NAME);
  return packageRootFromExecutable(value);
}

function packageRootFromExecutable(executable: string): string | null {
  let cursor = path.dirname(canonicalPath(executable));
  for (;;) {
    const manifest = path.join(cursor, "package.json");
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (isRecord(parsed) && parsed.name === PACKAGE_NAME) return cursor;
    } catch {
      // Keep walking from a bin shim toward the package root.
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}


async function resolveExecutablePath(command: string): Promise<string | null> {
  if (command === "vp") {
    const vpBinary = path.join(os.homedir(), ".vite-plus", "bin", "vp");
    if (existsSync(vpBinary)) return canonicalPath(vpBinary);
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(lookup, [command], { timeout: 2_000, windowsHide: true });
    const candidate = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    return candidate && existsSync(candidate) ? canonicalPath(candidate) : null;
  } catch {
    return null;
  }
}

function canonicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function samePath(left: string, right: string): boolean {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

/** Compare stable semver values; prereleases correctly sort below their stable counterpart. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, string | null] => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value);
    if (!match) return [0, 0, 0, null];
    return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
  };
  const a = parse(left);
  const b = parse(right);
  const numericParts: readonly (readonly [number, number])[] = [
    [a[0], b[0]],
    [a[1], b[1]],
    [a[2], b[2]],
  ];
  for (const [leftPart, rightPart] of numericParts) {
    const delta = leftPart - rightPart;
    if (delta !== 0) return delta;
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3].localeCompare(b[3]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
