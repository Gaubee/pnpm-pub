/**
 * Update worker for one bounded action. Installation streams package-manager
 * output while the daemon stays alive; restart waits for that daemon to stop
 * before launching the newly installed entry.
 */
import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { AppUpdateWorkerRequestSchema } from "./update-worker-schema.js";
import { updateCommand } from "./app-update.js";

const request = AppUpdateWorkerRequestSchema.parse(JSON.parse(process.argv[2] ?? "{}"));

async function main(): Promise<void> {
  if (request.action === "restart") {
    await restartDaemon();
    return;
  }
  await installUpdate();
}

async function installUpdate(): Promise<void> {
  const args = updateCommand(request.manager);
  process.stdout.write(`Installing pnpm-pub ${request.expectedVersion} with ${request.manager}...\n`);
  await runPackageManager(args);
  process.stdout.write("Validating installed package...\n");
  const installed = await installedVersion(request.packageRoot);
  if (installed !== request.expectedVersion) {
    throw new Error(`Update validation failed: expected ${request.expectedVersion}, found ${installed ?? "none"}.`);
  }
  process.stdout.write(`Installed pnpm-pub ${installed}.\n`);
}

async function restartDaemon(): Promise<void> {
  await waitForProcessExit(request.daemonPid);
  const child = spawn(request.nodePath, [request.daemonEntry], {
    detached: true,
    stdio: "ignore",
    env: request.env,
  });
  child.unref();
}

async function runPackageManager(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(request.executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: request.env,
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The package-manager update timed out after 120 seconds."));
    }, 120_000);
    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Package manager exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}.`));
    });
  });
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
