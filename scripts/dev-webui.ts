import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { SpawnOptions } from "node:child_process";

const HOST = "127.0.0.1";

export interface ManagedChild {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
}

export type DevWebuiSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ManagedChild;

export const main = async (spawnImpl: DevWebuiSpawn = spawn): Promise<void> => {
  const port = await resolveDevWebuiPort();
  const child = spawnImpl(
    "pnpm",
    ["--dir", "webui", "exec", "vp", "dev", "--host", HOST, "--port", String(port), "--strictPort"],
    {
      stdio: "inherit",
      env: { ...process.env, PNPM_PUB_DEV_WEBUI_PORT: String(port) },
    },
  );

  let requestedStop = false;
  const forward = (signal: NodeJS.Signals): void => {
    requestedStop = true;
    if (child.exitCode === null) child.kill(signal);
  };
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));

  const code = await new Promise<number>((resolve) => {
    child.once("exit", (exitCode, signal) => {
      if (requestedStop) {
        resolve(0);
        return;
      }
      if (typeof exitCode === "number") resolve(exitCode);
      else resolve(signal === null ? 1 : 0);
    });
  });
  process.exitCode = code;
};

async function resolveDevWebuiPort(): Promise<number> {
  const explicit = process.env.PNPM_PUB_DEV_WEBUI_PORT;
  if (explicit) return parsePort(explicit);
  return allocateRandomPort();
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid PNPM_PUB_DEV_WEBUI_PORT: ${value}`);
  }
  return port;
}

function allocateRandomPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, HOST, () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close((error) => {
        if (error) reject(error);
        else if (port > 0) resolve(port);
        else reject(new Error("Failed to allocate a WebUI dev port"));
      });
    });
  });
}

function isDirectInvocation(): boolean {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isDirectInvocation()) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
