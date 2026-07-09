#!/usr/bin/env node
/**
 * pnpm-pub CLI entry — the thin client (Chapter 7).
 *
 * Routing (Chapter 7.1):
 *   pnpm-pub start [--profile]    -> spawn daemon + open tray
 *   pnpm-pub status               -> query daemon status
 *   pnpm-pub stop                 -> graceful shutdown
 *   pnpm-pub help                 -> print pnpm-pub command help
 *   pnpm-pub daemon <start|status|stop>
 *                                   -> namespaced daemon management
 *   pnpm-pub <anything-else>      -> treated as `pnpm publish <args>` (fallback)
 *
 * The fallback is the key UX guarantee: muscle-memory compatibility with
 * `pnpm publish` (Chapter 7.1.2). yargs is used only for coarse parsing; the
 * explicit management commands are resolved before EVERYTHING else is
 * forwarded verbatim to the daemon as a publish intent.
 */
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { encodeFrame, FrameReader, isIpcFrame } from "../shared/frame.js";
import type {
  IpcPublishRequest,
  IpcHandshake,
  IpcManagementRequest,
  IpcOidcRequest,
  IpcCancelRequest,
} from "../shared/index.js";
import { readPackageVersion } from "../shared/package-version.js";
import { daemonLogPath, ensureAppDirs, socketPath } from "../shared/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The daemon entry the CLI spawns. Bundled output uses dist/daemon.js; source
// execution falls back to src/daemon/main.ts so `pnpm dev:cli` works without a
// build step. PNPM_PUB_DAEMON_ENTRY remains the explicit override.
const DAEMON_ENTRY = resolveDaemonEntry();
const CLI_VERSION = readPackageVersion();
const execFileAsync = promisify(execFile);
const PROFILE_ERROR = "--profile requires a value (e.g. --profile alice).";
type CliCommandRunContext = { profile?: string };
type CliCommandRun = (context: CliCommandRunContext) => Promise<number> | number;
type CliCommandSpec =
  | {
      name: string;
      kind: "action";
      usage: string;
      description: string;
      daemonCommand: boolean;
      acceptsProfile: boolean;
      run: CliCommandRun;
    }
  | {
      name: string;
      kind: "namespace";
      usage: string;
      description: string;
      daemonCommand: false;
      acceptsProfile: false;
    };
const CLI_OPTIONS = [
  { usage: "--profile <name>", description: "Profile to use for the action" },
] as const;
const CLI_COMMANDS = [
  {
    name: "start",
    kind: "action",
    usage: "start [--profile <name>]",
    description: "Boot the daemon and open the tray window",
    daemonCommand: true,
    acceptsProfile: true,
    run: ({ profile }) => runStart(profile),
  },
  {
    name: "status",
    kind: "action",
    usage: "status",
    description: "Check the running daemon and active profile",
    daemonCommand: true,
    acceptsProfile: false,
    run: (_context) => runStatus(),
  },
  {
    name: "stop",
    kind: "action",
    usage: "stop",
    description: "Gracefully stop the daemon",
    daemonCommand: true,
    acceptsProfile: false,
    run: (_context) => runStop(),
  },
  {
    name: "oidc",
    kind: "action",
    usage:
      "oidc [package-name ...] [--recursive] [--provider github|gitlab|circleci] [--file <workflow.yml>]",
    description: "Create Trusted Publishing Event(s)",
    daemonCommand: false,
    acceptsProfile: true,
    run: (_context) => runHelp(),
  },
  {
    name: "daemon",
    kind: "namespace",
    usage: "daemon",
    description: "Run a namespaced daemon management command",
    daemonCommand: false,
    acceptsProfile: false,
  },
  {
    name: "version",
    kind: "action",
    usage: "version",
    description: "Print the pnpm-pub version",
    daemonCommand: false,
    acceptsProfile: false,
    run: (_context) => runVersion(),
  },
  {
    name: "help",
    kind: "action",
    usage: "help",
    description: "Print this help",
    daemonCommand: false,
    acceptsProfile: false,
    run: (_context) => runHelp(),
  },
] as const satisfies readonly CliCommandSpec[];
type CliCommandDefinition = (typeof CLI_COMMANDS)[number];
type CliActionCommandDefinition = Extract<CliCommandDefinition, { kind: "action" }>;
type DaemonCommandDefinition = Extract<CliCommandDefinition, { daemonCommand: true }>;
const DAEMON_COMMANDS = CLI_COMMANDS.filter(isDaemonCommandDefinition);

function resolveDaemonEntry(): string {
  const configured = process.env.PNPM_PUB_DAEMON_ENTRY;
  if (configured && configured.length > 0) return configured;
  const bundledEntry = path.join(__dirname, "daemon.js");
  if (fs.existsSync(bundledEntry)) return bundledEntry;
  const sourceEntry = path.resolve(__dirname, "../daemon/main.ts");
  return fs.existsSync(sourceEntry) ? sourceEntry : bundledEntry;
}

function daemonSpawnArgs(entry: string): string[] {
  if (!entry.endsWith(".ts") || path.basename(process.execPath) !== "node") return [entry];
  return [...filterDaemonExecArgv(process.execArgv), entry];
}

function filterDaemonExecArgv(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print") {
      index += 1;
      continue;
    }
    if (
      arg.startsWith("--eval=") ||
      arg.startsWith("--print=") ||
      arg === "--check" ||
      arg === "-c"
    ) {
      continue;
    }
    out.push(arg);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daemon connection helpers (Chapter 7.2.1 — auto-booting ghost process).
// ---------------------------------------------------------------------------

async function connectWithRetry(maxWaitMs: number): Promise<net.Socket | null> {
  const start = Date.now();
  for (;;) {
    try {
      const sock = await connectOnce();
      if (sock) return sock;
    } catch {
      /* keep trying */
    }
    if (Date.now() - start > maxWaitMs) return null;
    await sleep(150);
  }
}

function connectOnce(): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath());
    sock.once("connect", () => resolve(sock));
    sock.once("error", () => resolve(null));
  });
}

function spawnDaemon(): void {
  // Detached ghost process — outlives the parent terminal (Chapter 5.1.2).
  // Redirect stdout/stderr into the daemon log so IPC errors / uncaught
  // rejections are recoverable instead of going to /dev/null.
  const stdio: Array<"ignore" | number> = ["ignore", "ignore", "ignore"];
  try {
    ensureAppDirs();
    const fd = fs.openSync(daemonLogPath(), "a");
    stdio[1] = fd;
    stdio[2] = fd;
  } catch {
    /* fall back to ignore */
  }
  const child = spawn(process.execPath, daemonSpawnArgs(DAEMON_ENTRY), {
    detached: true,
    stdio: stdio as ["ignore" | number, "ignore" | number, "ignore" | number],
    env: { ...process.env },
  });
  child.unref();
}

async function ensureDaemon(): Promise<net.Socket | null> {
  let sock = await connectWithRetry(500);
  if (!sock) {
    spawnDaemon();
    sock = await connectWithRetry(10_000);
  }
  return sock;
}

// ---------------------------------------------------------------------------
// Command flows.
// ---------------------------------------------------------------------------

async function runPublish(cwd: string, args: string[], profileOverride?: string): Promise<number> {
  // Version handshake loop (Chapter 7.2.1). When the CLI is newer than the
  // running daemon, the daemon self-exits and returns the `daemon-outdated`
  // signal; the CLI then re-spawns a fresh daemon and retries the publish.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sock, outdated } = await handshakeAndWait();
    if (outdated) {
      // The daemon signaled it is older than the CLI. It has already (or is
      // about to) self-exit; spawn a fresh one and loop.
      try {
        sock?.end();
      } catch {
        /* ignore */
      }
      spawnDaemon();
      await sleep(500); // give the old daemon time to release the socket lock
      continue;
    }
    if (!sock) {
      process.stderr.write("Failed to start the pnpm-pub daemon.\n");
      return 1;
    }

    const req: IpcPublishRequest = {
      command: "publish",
      cwd,
      args,
      profileOverride,
      clientPid: process.pid,
    };
    sock.write(encodeFrame(req));

    process.stdout.write("> Waiting for GUI confirmation. Please check your system tray...\n");
    return relay(sock);
  }
  process.stderr.write("Could not bring the daemon up to date after retry.\n");
  return 1;
}

async function runOidc(args: string[], profileOverride?: string): Promise<number> {
  const parsed = parseOidcArgs(args);
  if (!parsed.ok) {
    writeOidcCliError(args, parsed.error);
    return 1;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sock, outdated } = await handshakeAndWait();
    if (outdated) {
      try {
        sock?.end();
      } catch {
        /* ignore */
      }
      spawnDaemon();
      await sleep(500);
      continue;
    }
    if (!sock) {
      process.stderr.write("Failed to start the pnpm-pub daemon.\n");
      return 1;
    }
    const req: IpcOidcRequest = {
      command: "oidc",
      ...parsed.request,
      ...(profileOverride ? { profileOverride } : {}),
      clientPid: process.pid,
    };
    sock.write(encodeFrame(req));
    return relay(sock);
  }
  process.stderr.write("Could not bring the daemon up to date after retry.\n");
  return 1;
}

function writeOidcCliError(args: string[], error: string): void {
  if (args.includes("--json")) {
    process.stdout.write(
      JSON.stringify({ ok: false, command: "oidc", error, events: [] }, null, 2) + "\n",
    );
    return;
  }
  process.stderr.write(`${error}\n`);
}

type ParsedOidcArgs =
  | {
      ok: true;
      request: Omit<IpcOidcRequest, "command" | "profileOverride">;
    }
  | {
      ok: false;
      error: string;
    };

function parseOidcArgs(args: string[]): ParsedOidcArgs {
  const request: Omit<IpcOidcRequest, "command" | "profileOverride"> = {
    cwd: process.cwd(),
    packageNames: [],
    recursive: false,
  };
  const readValue = (
    index: number,
    option: string,
  ): { value?: string; nextIndex: number; error?: string } => {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      return { nextIndex: index, error: `${option} requires a value.` };
    }
    return { value, nextIndex: index + 1 };
  };
  const appendContextIds = (value: string): void => {
    const ids = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    request.circleContextIds = [...(request.circleContextIds ?? []), ...ids];
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") {
      request.packageNames.push(...args.slice(index + 1).filter((value) => value.length > 0));
      break;
    }
    if (arg === "-r" || arg === "--recursive") {
      request.recursive = true;
      continue;
    }
    if (arg === "--no-recursive") {
      request.recursive = false;
      continue;
    }
    if (arg === "--remove") {
      request.remove = true;
      continue;
    }
    if (arg === "--no-remove") {
      request.remove = false;
      continue;
    }
    if (arg === "--allow-publish") {
      request.allowPublish = true;
      continue;
    }
    if (arg === "--no-allow-publish") {
      request.allowPublish = false;
      continue;
    }
    if (arg === "--allow-stage-publish") {
      request.allowStagePublish = true;
      continue;
    }
    if (arg === "--no-allow-stage-publish") {
      request.allowStagePublish = false;
      continue;
    }
    if (arg === "--json") {
      request.json = true;
      continue;
    }
    if (arg === "--no-json") {
      request.json = false;
      continue;
    }
    if (arg === "--workflow" || arg.startsWith("--workflow=")) {
      return { ok: false, error: "Use --file <workflow.yml>; --workflow is not supported." };
    }

    const inline = arg.match(/^--([^=]+)=(.*)$/);
    const shortDir = arg.match(/^-C=(.*)$/);
    if (shortDir) {
      request.cwd = path.resolve(process.cwd(), shortDir[1]!);
      continue;
    }
    if (inline) {
      const key = inline[1]!;
      const value = inline[2]!;
      const applied = applyOidcOptionValue(request, key, value, appendContextIds);
      if (!applied.ok) return { ok: false, error: applied.error };
      continue;
    }

    const optionKey = oidcOptionKey(arg);
    if (optionKey) {
      const read = readValue(index, arg);
      if (read.error) return { ok: false, error: read.error };
      const applied = applyOidcOptionValue(request, optionKey, read.value!, appendContextIds);
      if (!applied.ok) return { ok: false, error: applied.error };
      index = read.nextIndex;
      continue;
    }

    if (arg.startsWith("-")) {
      return { ok: false, error: `unknown oidc option: ${arg}` };
    }
    request.packageNames.push(arg);
  }
  request.packageNames = [
    ...new Set(request.packageNames.map((name) => name.trim()).filter(Boolean)),
  ];
  return { ok: true, request };
}

function oidcOptionKey(arg: string): string | null {
  switch (arg) {
    case "-C":
    case "--dir":
      return "dir";
    case "--provider":
      return "provider";
    case "--repo":
      return "repo";
    case "--file":
      return "file";
    case "--env":
      return "env";
    case "--project-path":
      return "project-path";
    case "--ci-file":
      return "ci-file";
    case "--circle-org-id":
      return "circle-org-id";
    case "--circle-project-id":
      return "circle-project-id";
    case "--circle-pipeline-definition-id":
      return "circle-pipeline-definition-id";
    case "--circle-context-id":
    case "--circle-context-ids":
      return "circle-context-id";
    case "--vcs-origin":
      return "vcs-origin";
    default:
      return null;
  }
}

function applyOidcOptionValue(
  request: Omit<IpcOidcRequest, "command" | "profileOverride">,
  key: string,
  value: string,
  appendContextIds: (value: string) => void,
): { ok: true } | { ok: false; error: string } {
  if (value.length === 0) return { ok: false, error: `--${key} requires a value.` };
  switch (key) {
    case "dir":
      request.cwd = path.resolve(process.cwd(), value);
      return { ok: true };
    case "provider":
      if (value !== "github" && value !== "gitlab" && value !== "circleci") {
        return { ok: false, error: "--provider must be github, gitlab, or circleci." };
      }
      request.provider = value;
      return { ok: true };
    case "repo":
      request.repo = value;
      return { ok: true };
    case "file":
      request.file = value;
      return { ok: true };
    case "env":
      request.env = value;
      return { ok: true };
    case "project-path":
      request.projectPath = value;
      return { ok: true };
    case "ci-file":
      request.ciFile = value;
      return { ok: true };
    case "circle-org-id":
      request.circleOrgId = value;
      return { ok: true };
    case "circle-project-id":
      request.circleProjectId = value;
      return { ok: true };
    case "circle-pipeline-definition-id":
      request.circlePipelineDefinitionId = value;
      return { ok: true };
    case "circle-context-id":
      appendContextIds(value);
      return { ok: true };
    case "vcs-origin":
      request.vcsOrigin = value;
      return { ok: true };
    default:
      return { ok: false, error: `unknown oidc option: --${key}` };
  }
}

function isPublishTerminalIntent(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "--help" || arg === "-h" || arg === "--version") return true;
  }
  return false;
}

function readExecText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExecExitCode(error: unknown): number {
  if (!isRecord(error)) return 1;
  const code = error.code;
  return typeof code === "number" ? code : 1;
}

async function runNativePublishTerminalIntent(args: string[]): Promise<number> {
  try {
    const result = await execFileAsync("pnpm", ["publish", ...args], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return 0;
  } catch (error: unknown) {
    if (isRecord(error)) {
      const stdout = readExecText(error.stdout);
      const stderr = readExecText(error.stderr);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
    return readExecExitCode(error);
  }
}

function readProfileValue(value: string | undefined): { profile?: string; error?: string } {
  if (value === undefined) return {};
  if (value.length === 0) return { error: PROFILE_ERROR };
  return { profile: value };
}

/**
 * Send the version handshake and wait briefly to see whether the daemon
 * responds with the `daemon-outdated` self-destruct signal. Returns the live
 * socket plus an `outdated` flag (Chapter 7.2.1).
 *
 * The normal (current) daemon stays silent after the handshake and only acts on
 * the subsequent publish intent — so we wait up to `graceMs` for the outdated
 * signal, and if none arrives we hand the still-open socket to `relay()`. We
 * never detach the data listener (the publish frames arrive on this socket).
 */
async function handshakeAndWait(
  graceMs = 300,
): Promise<{ sock: net.Socket | null; outdated: boolean }> {
  const sock = await ensureDaemon();
  if (!sock) return { sock: null, outdated: false };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outdated: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.removeListener("close", onClose);
      resolve({ sock: outdated ? null : sock, outdated });
    };
    const onData = (chunk: Buffer): void => {
      // Peek for the outdated signal without consuming the stream — relay()
      // owns frame parsing. We only look for the sentinel string.
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (text.includes('"daemon-outdated"')) {
        finish(true);
      }
    };
    const onClose = (): void => finish(false);
    const timer = setTimeout(() => finish(false), graceMs);

    sock.on("data", onData);
    sock.on("close", onClose);

    sock.write(encodeFrame({ cliVersion: CLI_VERSION } satisfies IpcHandshake));
  });
}

/** Pipe daemon frames to stdout/stderr and resolve on exit frame (Chapter 7.2.4). */
function relay(sock: net.Socket): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FrameReader();
    let settled = false;
    const signalExitCode = (signal: NodeJS.Signals): number =>
      signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
    const cleanup = (): void => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      process.off("SIGHUP", onSignal);
    };
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };
    const onSignal = (signal: NodeJS.Signals): void => {
      if (settled) process.exit(signalExitCode(signal));
      settled = true;
      const code = signalExitCode(signal);
      cleanup();
      const forceExit = setTimeout(() => {
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
        process.exit(code);
      }, 250);
      sock.once("close", () => {
        clearTimeout(forceExit);
        process.exit(code);
      });
      try {
        sock.write(encodeFrame({ command: "cancel" } satisfies IpcCancelRequest), () => {
          try {
            sock.end();
          } catch {
            clearTimeout(forceExit);
            process.exit(code);
          }
        });
      } catch {
        clearTimeout(forceExit);
        process.exit(code);
      }
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    process.once("SIGHUP", onSignal);
    sock.on("data", (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) {
          process.stderr.write("Invalid daemon IPC frame.\n");
          finish(1);
          continue;
        }
        if (frame.type === "stdout") process.stdout.write(frame.data);
        else if (frame.type === "stderr") process.stderr.write(frame.data);
        else if (frame.type === "exit") {
          try {
            sock.end();
          } catch {
            /* ignore */
          }
          finish(frame.code);
        }
      }
    });
    sock.on("close", () => finish(1));
    sock.on("error", () => finish(1));
  });
}

async function runStatus(): Promise<number> {
  const sock = await connectWithRetry(500);
  if (!sock) {
    process.stdout.write("Daemon is not running.\n");
    return 0;
  }
  sock.write(encodeFrame({ command: "status" }));
  await new Promise<void>((resolve) => {
    const reader = new FrameReader();
    sock.on("data", (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) continue;
        if (frame.type === "status") {
          if (frame.active) {
            process.stdout.write(
              `Daemon running (pid=${frame.pid ?? "?"}). Active profile: ${frame.profile ?? "(none)"}\n`,
            );
          } else {
            process.stdout.write("Daemon is stopping.\n");
          }
          resolve();
        }
      }
    });
    sock.on("close", () => resolve());
  });
  return 0;
}

async function runStop(): Promise<number> {
  const sock = await connectWithRetry(500);
  if (!sock) {
    process.stdout.write("Daemon is not running.\n");
    return 0;
  }
  sock.write(encodeFrame({ command: "stop" }));
  try {
    sock.end();
  } catch {
    /* ignore */
  }
  process.stdout.write("Stop signal sent.\n");
  return 0;
}

async function runStart(profileOverride?: string): Promise<number> {
  const sock = await ensureDaemon();
  if (!sock) {
    process.stderr.write("Failed to start the pnpm-pub daemon.\n");
    return 1;
  }
  // Chapter 7.1.1: `start [--profile=*]` selects the default identity the
  // daemon should load. We send a management request so the daemon applies it.
  if (profileOverride && profileOverride.length > 0) {
    sock.write(encodeFrame({ command: "start", profileOverride } satisfies IpcManagementRequest));
    return relayStart(sock);
  }
  try {
    sock.end();
  } catch {
    /* ignore */
  }
  process.stdout.write("Daemon started. Open the tray to interact.\n");
  return 0;
}

function relayStart(sock: net.Socket): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FrameReader();
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      try {
        sock.end();
      } catch {
        /* ignore */
      }
      resolve(code);
    };
    sock.on("data", (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcFrame(frame)) continue;
        if (frame.type === "stdout") {
          process.stdout.write(frame.data);
        } else if (frame.type === "stderr") {
          process.stderr.write(frame.data);
        } else if (frame.type === "status") {
          process.stdout.write("Daemon started. Open the tray to interact.\n");
          finish(0);
          return;
        } else if (frame.type === "exit") {
          if (frame.message) process.stderr.write(`${frame.message}\n`);
          finish(frame.code);
          return;
        }
      }
    });
    sock.on("close", () => finish(settled ? 0 : 1));
    sock.on("error", () => finish(1));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function runVersion(): number {
  // pnpm-pub's own version. Note `pnpm-pub --version` is distinct: it is a
  // publish terminal intent (Chapter 7.1.2) and forwards to `pnpm publish
  // --version` (≡ `pnpm --version`), preserving muscle-memory parity.
  process.stdout.write(`${CLI_VERSION}\n`);
  return 0;
}

function runHelp(): number {
  process.stdout.write(formatCliHelp());
  return 0;
}

/** Extract --profile[=...] from a raw arg list. */
function extractProfile(args: string[]): { profile?: string; rest: string[]; error?: string } {
  let profile: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      rest.push(...args.slice(i));
      break;
    }
    const eq = a.match(/^--profile=(.*)$/);
    if (eq) {
      const parsed = readProfileValue(eq[1]);
      if (parsed.error) return { rest, error: parsed.error };
      profile = parsed.profile;
      continue;
    }
    if (a === "--profile") {
      // A bare trailing --profile with no value is a user error — surface it
      // rather than silently dropping the flag and publishing under default.
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        return { rest, error: PROFILE_ERROR };
      }
      const parsed = readProfileValue(next);
      if (parsed.error) return { rest, error: parsed.error };
      profile = parsed.profile;
      i++; // consume value
      continue;
    }
    rest.push(a);
  }
  return { profile, rest };
}

function toPositionalStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

function resolveManagementCommand(positional: string[]): {
  command?: CliActionCommandDefinition;
  error?: string;
} {
  const head = positional[0];
  if (head === "daemon") {
    return resolveDaemonManagementCommand(positional.slice(1));
  }
  const command = findCliActionCommand(head);
  if (command) return { command };
  return {};
}

function resolveDaemonManagementCommand(positional: string[]): {
  command?: DaemonCommandDefinition;
  error?: string;
} {
  const command = positional[0];
  if (!command) {
    return { error: `daemon requires a command: ${formatDaemonCommandList()}.` };
  }
  const daemonCommand = findDaemonCommand(command);
  if (!daemonCommand) {
    return {
      error: `unknown daemon command: ${command}. Expected ${formatDaemonCommandList()}.`,
    };
  }
  const extra = positional.slice(1);
  if (extra.length > 0) {
    return {
      error: `daemon ${command} does not accept positional arguments: ${extra.join(" ")}.`,
    };
  }
  return { command: daemonCommand };
}

function isDaemonCommandDefinition(
  command: CliCommandDefinition,
): command is DaemonCommandDefinition {
  return command.daemonCommand;
}

function findCliActionCommand(value: string | undefined): CliActionCommandDefinition | undefined {
  if (!value) return undefined;
  return CLI_COMMANDS.find(
    (command): command is CliActionCommandDefinition =>
      command.kind === "action" && command.name === value,
  );
}

function findDaemonCommand(value: string | undefined): DaemonCommandDefinition | undefined {
  if (!value) return undefined;
  return DAEMON_COMMANDS.find((command) => command.name === value);
}

function formatDaemonCommandList(): string {
  return joinCommandNames(DAEMON_COMMANDS.map((command) => command.name));
}

function joinCommandNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

/** Render pnpm-pub's local command projection without changing publish fallback law. */
export function formatCliHelp(): string {
  const nameColumnWidth = Math.max(...CLI_COMMANDS.map((command) => command.name.length));
  return [
    "pnpm-pub",
    "",
    "Usage:",
    ...CLI_COMMANDS.map((command) => `  pnpm-pub ${formatCliCommandUsage(command)}`),
    "  pnpm-pub [publish args...]",
    "",
    "Commands:",
    ...CLI_COMMANDS.map(
      (command) => `  ${command.name.padEnd(nameColumnWidth)}  ${command.description}`,
    ),
    "",
    "Options:",
    ...CLI_OPTIONS.map((option) => `  ${option.usage}  ${option.description}`),
    "",
    "Unknown commands and flags are forwarded to pnpm publish as the publish intent.",
    "",
  ].join("\n");
}

function formatCliCommandUsage(command: CliCommandDefinition): string {
  if (command.kind === "namespace") {
    return `${command.usage} <${DAEMON_COMMANDS.map((item) => item.name).join("|")}>`;
  }
  return command.usage;
}

function registerCliCommands(parser: Argv): Argv {
  let registered = parser;
  for (const command of CLI_COMMANDS) {
    registered = registered.command(command.name, command.description, (builder) => {
      if (command.acceptsProfile) {
        return builder.option("profile", { type: "string" });
      }
      return builder;
    });
  }
  return registered;
}

/** Project a fatal CLI error to stderr without assuming thrown values are Error instances. */
export function formatCliFatalError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** Detect direct bin execution through npm's symlinked command shim. */
export function isCliEntrypointInvocation(
  argvEntry: string | undefined,
  moduleUrl: string,
): boolean {
  if (!argvEntry) return false;
  const modulePath = fileURLToPath(moduleUrl);
  return resolveComparablePath(argvEntry) === resolveComparablePath(modulePath);
}

function resolveComparablePath(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

// ---------------------------------------------------------------------------
// yargs entry (Chapter 7.1) — management commands first; everything else is an
// implicit publish intent (7.1.2).
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<void> {
  const rawArgs = hideBin(argv);
  const rawCommand = findCliActionCommand(rawArgs[0]);
  if (rawCommand?.name === "help") {
    process.exit(await runCliAction(rawCommand, { profile: undefined }));
  }
  const oidcProfile = extractProfile(rawArgs);
  if (oidcProfile.error) {
    process.stderr.write(`${oidcProfile.error}\n`);
    process.exit(1);
  }
  if (oidcProfile.rest[0] === "oidc") {
    process.exit(await runOidc(oidcProfile.rest.slice(1), oidcProfile.profile));
  }

  const parsed = await registerCliCommands(yargs(rawArgs).scriptName("pnpm-pub"))
    .option("profile", { type: "string", describe: "Profile to use for the action" })
    .help(false)
    .version(false)
    .fail((_, _err, yargsInstance) => {
      // On any parse failure we fall back to treating the full argv as a
      // publish intent (Chapter 7.1.2 — never surface yargs errors).
      void yargsInstance;
    })
    .parseAsync();

  const parsedProfile = readProfileValue(parsed.profile);
  if (parsedProfile.error) {
    process.stderr.write(`${parsedProfile.error}\n`);
    process.exit(1);
  }

  // Explicit subcommand?
  const positional = toPositionalStrings(parsed._);
  const management = resolveManagementCommand(positional);
  if (management.error) {
    process.stderr.write(`${management.error}\n`);
    process.exit(1);
  }
  if (management.command) {
    process.exit(await runCliAction(management.command, { profile: parsedProfile.profile }));
  }

  // Fallback: everything is a publish intent. We deliberately re-read the raw
  // argv (excluding any --profile) so pnpm publish flags pass through 1:1.
  const extracted = extractProfile(rawArgs);
  if (extracted.error) {
    process.stderr.write(`${extracted.error}\n`);
    process.exit(1);
  }
  const { profile, rest } = extracted;
  const publishArgs = rest[0] === "publish" ? rest.slice(1) : rest;
  if (isPublishTerminalIntent(publishArgs)) {
    process.exit(await runNativePublishTerminalIntent(publishArgs));
  }
  process.exit(await runPublish(process.cwd(), publishArgs, profile));
}

async function runCliAction(
  command: CliActionCommandDefinition,
  context: CliCommandRunContext,
): Promise<number> {
  return Promise.resolve(command.run(context));
}

// Run when invoked as the bin entrypoint.
const invokedDirectly = isCliEntrypointInvocation(process.argv[1], import.meta.url);
if (invokedDirectly) {
  main(process.argv).catch((err) => {
    process.stderr.write(`${formatCliFatalError(err)}\n`);
    process.exit(1);
  });
}
