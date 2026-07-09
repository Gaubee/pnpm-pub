import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
type BuildStatus = "running" | "passed" | "failed";

type TerminalData = string | Uint8Array;

interface BunTerminal {
  close(): void;
}

interface BunTerminalOptions {
  cols: number;
  rows: number;
  data(terminal: BunTerminal, data: TerminalData): void;
}

interface BunSubprocess {
  exited: Promise<number>;
  kill(signal?: string): void;
}

interface BunRuntime {
  Terminal: new (options: BunTerminalOptions) => BunTerminal;
  spawn(
    command: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      terminal: BunTerminal;
    },
  ): BunSubprocess;
}

declare const Bun: BunRuntime;

interface BuildTask {
  id: string;
  title: string;
  command: string[];
}

interface RunningTask extends BuildTask {
  status: BuildStatus;
  code: number | null;
  process: BunSubprocess;
  terminal: BunTerminal;
  currentLine: string;
  skipNextLineFeed: boolean;
  outputDecoder: TextDecoder;
  startedAt: number;
  finishedAt: number | null;
}

const root = process.cwd();
const tasks: BuildTask[] = [
  {
    id: "core",
    title: "CLI + daemon",
    command: [process.execPath, "run", "scripts/build/core.ts"],
  },
  {
    id: "webui",
    title: "SvelteKit WebUI",
    command: ["pnpm", "--filter", "./webui", "run", "build"],
  },
];

const sourceWidth = Math.max(...tasks.map((task) => task.id.length));
const visiblePrefixWidth = sourceWidth + 3;
const wrapGuardColumns = 2;
const prefixColors = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m"];
const usePrefixColor = process.stdout.isTTY && !process.env.NO_COLOR;
const taskColors = new Map(
  tasks.map((task, index) => [task.id, prefixColors[index % prefixColors.length] ?? ""]),
);

function sanitizeTerminalControls(text: string): string {
  let output = "";
  let skippingControlSequence = false;
  let skippingOperatingSystemCommand = false;
  let controlSequence = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 27 && text.charAt(index + 1) === "[") {
      skippingControlSequence = true;
      controlSequence = "\x1b[";
      index += 1;
      continue;
    }
    if (code === 27 && text.charAt(index + 1) === "]") {
      skippingOperatingSystemCommand = true;
      index += 1;
      continue;
    }
    if (skippingControlSequence) {
      controlSequence += text.charAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        skippingControlSequence = false;
        if (text.charAt(index) === "m") output += controlSequence;
        controlSequence = "";
      }
      continue;
    }
    if (skippingOperatingSystemCommand) {
      if (code === 7) {
        skippingOperatingSystemCommand = false;
        continue;
      }
      if (code === 27 && text.charAt(index + 1) === "\\") {
        skippingOperatingSystemCommand = false;
        index += 1;
      }
      continue;
    }
    output += text.charAt(index);
  }
  return output;
}

function writePrefixedLine(task: BuildTask, line: string): void {
  const label = task.id.padEnd(sourceWidth, " ");
  const prefix = usePrefixColor
    ? `${taskColors.get(task.id) ?? ""}[${label}]\x1b[0m`
    : `[${label}]`;
  process.stdout.write(`${prefix} ${line}\n`);
}

function childTerminalColumns(): number {
  const envColumns = Number.parseInt(process.env.COLUMNS ?? "", 10);
  const parentColumns =
    process.stdout.columns ?? (Number.isFinite(envColumns) ? envColumns : undefined) ?? 80;
  return Math.max(40, Math.min(120, parentColumns - visiblePrefixWidth - wrapGuardColumns));
}

function durationMs(task: Pick<RunningTask, "startedAt" | "finishedAt">): number {
  return Math.round((task.finishedAt ?? performance.now()) - task.startedAt);
}

function pushTerminalOutput(task: RunningTask, data: TerminalData): void {
  const text = typeof data === "string" ? data : task.outputDecoder.decode(data, { stream: true });
  for (const char of sanitizeTerminalControls(text)) {
    if (task.skipNextLineFeed) {
      task.skipNextLineFeed = false;
      if (char === "\n") continue;
    }
    if (char === "\r") {
      if (task.currentLine.length > 0) {
        writePrefixedLine(task, task.currentLine);
        task.currentLine = "";
      }
      task.skipNextLineFeed = true;
      continue;
    }
    if (char === "\n") {
      writePrefixedLine(task, task.currentLine);
      task.currentLine = "";
      continue;
    }
    task.currentLine += char;
  }
}

function flushTerminalOutput(task: RunningTask): void {
  const remaining = task.outputDecoder.decode();
  if (remaining.length > 0) pushTerminalOutput(task, remaining);
  if (task.currentLine.length === 0) return;
  writePrefixedLine(task, task.currentLine);
  task.currentLine = "";
}

function spawnTask(task: BuildTask): RunningTask {
  const running = {
    ...task,
    status: "running" as const,
    code: null,
    currentLine: "",
    skipNextLineFeed: false,
    outputDecoder: new TextDecoder(),
    startedAt: performance.now(),
    finishedAt: null,
  } satisfies Omit<RunningTask, "process" | "terminal">;

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.NO_COLOR) env.FORCE_COLOR = "1";
  env.COLUMNS = String(childTerminalColumns());
  const pendingOutput: TerminalData[] = [];
  let runningTask: RunningTask | undefined;
  const terminal = new Bun.Terminal({
    cols: childTerminalColumns(),
    rows: 24,
    data(_terminal, data) {
      if (runningTask) {
        pushTerminalOutput(runningTask, data);
      } else {
        pendingOutput.push(data);
      }
    },
  });
  const subprocess = Bun.spawn(task.command, {
    cwd: root,
    env,
    terminal,
  });
  runningTask = { ...running, process: subprocess, terminal };
  for (const data of pendingOutput) pushTerminalOutput(runningTask, data);
  return runningTask;
}

async function stageWebui(): Promise<void> {
  const src = path.resolve(root, "webui", "build");
  const dest = path.resolve(root, "dist", "webui");
  await stat(src).catch(() => {
    throw new Error(`[build] WebUI build output not found: ${src}`);
  });
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
  console.log(`[build] WebUI staged -> ${path.relative(root, dest)}`);
}

async function main(): Promise<void> {
  console.log("[build] running core and WebUI builds in parallel");
  const runningTasks: RunningTask[] = [];
  for (const task of tasks) runningTasks.push(spawnTask(task));

  process.once("SIGINT", () => {
    for (const task of runningTasks) task.process.kill("SIGINT");
  });

  await Promise.all(
    runningTasks.map(async (task) => {
      const code = await task.process.exited;
      task.code = code;
      task.status = code === 0 ? "passed" : "failed";
      task.finishedAt = performance.now();
      flushTerminalOutput(task);
      task.terminal.close();
      console.log(`[build] ${task.title} ${task.status} in ${durationMs(task)}ms`);
    }),
  );

  const failed = runningTasks.filter((task) => task.code !== 0);
  if (failed.length > 0) {
    for (const task of failed)
      console.error(`[build] ${task.title} failed with exit code ${String(task.code)}`);
    process.exit(1);
  }

  await stageWebui();
  console.log("[build] complete");
}

await main();
