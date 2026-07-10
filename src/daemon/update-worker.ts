/**
 * Detached update handoff process. It waits for the old daemon to exit,
 * performs one fixed package-manager command, validates the installed package,
 * then starts the newly installed daemon. A failed handoff leaves the old
 * daemon untouched because this worker is launched before shutdown is requested.
 */
import { spawn, execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { AppUpdateWorkerRequestSchema } from "./update-worker-schema.js";
import { updateCommand } from "./app-update.js";

const execFileAsync = promisify(execFile);
const request = AppUpdateWorkerRequestSchema.parse(JSON.parse(process.argv[2] ?? "{}"));

async function main(): Promise<void> {
  const args = updateCommand(request.manager);
  await execFileAsync(request.executable, args, {
    timeout: 120_000,
    windowsHide: true,
    env: request.env,
  });
  const installed = await installedVersion(request.packageRoot);
  if (installed !== request.expectedVersion) {
    throw new Error(`Update validation failed: expected ${request.expectedVersion}, found ${installed ?? "none"}.`);
  }
  process.kill(request.daemonPid, "SIGTERM");
  await waitForProcessExit(request.daemonPid);
  const child = spawn(request.nodePath, [request.daemonEntry], {
    detached: true,
    stdio: "ignore",
    env: request.env,
  });
  child.unref();
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The existing pnpm-pub daemon did not stop in time.");
}

async function installedVersion(packageRoot: string): Promise<string | null> {
  try {
    const source: unknown = JSON.parse(await fsp.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (typeof source === "object" && source !== null && "version" in source) {
      const version = source.version;
      return typeof version === "string" && version.length > 0 ? version : null;
    }
    return null;
  } catch {
    return null;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
