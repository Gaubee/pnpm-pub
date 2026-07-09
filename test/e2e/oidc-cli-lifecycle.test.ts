/**
 * OIDC CLI lifecycle E2E.
 *
 * The CLI is the source of action for a Trusted Publishing Event, but registry
 * mutation still belongs behind WebUI confirmation/rejection. This test keeps
 * that cross-process conservation law honest: a spawned CLI must stay attached
 * until the WebUI resolves its pending event.
 */
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { bootDaemon, type DaemonHandles } from "../../src/daemon/index.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { readPackageVersion } from "../../src/shared/package-version.js";
import { openRpcClient } from "../unit/orpc-test-client.js";

// Keep the path short: macOS Unix socket paths fail around ~104 bytes.
const sandbox = `/tmp/ppoidc-${process.pid}-${Date.now()}`;
const packageDir = path.join(sandbox, "pkg");

let handles: DaemonHandles | null = null;

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function waitForCondition(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function waitForChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 5_000,
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("Timed out waiting for CLI process"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function spawnOidcCli(): ChildProcessWithoutNullStreams {
  return spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli/cli.ts",
      "oidc",
      "--json",
      "-C",
      packageDir,
      "--file",
      "publish.yml",
    ],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: { ...process.env, PNPM_PUB_HOME: sandbox },
    },
  );
}

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(packageDir, { recursive: true });
  setHomeOverride(sandbox);
  await fsp.writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "@scope/oidc-cli-lifecycle",
      version: "1.0.0",
      repository: "https://github.com/owner/repo.git",
    }),
    "utf8",
  );
  handles = await bootDaemon({ cliVersion: readPackageVersion(), withTray: false });
  expect(handles).not.toBeNull();
  await handles!.store.upsertProfile({
    username: "alice",
    registry: "https://registry.npmjs.org/",
  });
  await handles!.store.setDefault("alice");
});

afterEach(async () => {
  await handles?.stop({ exit: false });
  handles = null;
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Feature: pnpm-pub oidc CLI lifecycle", () => {
  it("Scenario: Given oidc --json is waiting, When WebUI rejects the Event, Then the CLI returns structured failure", async () => {
    const child = spawnOidcCli();
    const resultPromise = waitForChild(child);

    await waitForCondition(() =>
      handles!.store.getEvents().some((event) => event.status === "pending"),
    );
    const pending = handles!.store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("configure-trust");

    const rpc = await openRpcClient(handles!.port, handles!.webToken);
    try {
      await rpc.client.events.reject({ id: pending!.id });
    } finally {
      rpc.close();
    }

    const result = await resultPromise;
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual(
      expect.objectContaining({
        ok: false,
        command: "oidc",
        eventIds: [pending!.id],
      }),
    );
    expect(isRecord(parsed) ? parsed.events : undefined).toEqual([
      expect.objectContaining({
        id: pending!.id,
        status: "rejected",
        action: "add",
        target: "@scope/oidc-cli-lifecycle",
        code: 1,
        message: "Trusted Publishing Event rejected by user.",
      }),
    ]);
  });

  it("Scenario: Given oidc --json is waiting, When WebUI confirms the Event, Then the CLI returns the final confirm result", async () => {
    const child = spawnOidcCli();
    const resultPromise = waitForChild(child);

    await waitForCondition(() =>
      handles!.store.getEvents().some((event) => event.status === "pending"),
    );
    const pending = handles!.store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("configure-trust");

    const rpc = await openRpcClient(handles!.port, handles!.webToken);
    try {
      await rpc.client.events.confirm({ id: pending!.id });
    } finally {
      rpc.close();
    }

    const result = await resultPromise;
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toEqual(
      expect.objectContaining({
        ok: false,
        command: "oidc",
        eventIds: [pending!.id],
      }),
    );
    expect(isRecord(parsed) ? parsed.events : undefined).toEqual([
      expect.objectContaining({
        id: pending!.id,
        status: "action-required",
        action: "add",
        target: "@scope/oidc-cli-lifecycle",
        code: 1,
        message: "Credentials for alice are missing. Re-apply them in the tray.",
      }),
    ]);
  });

  it("Scenario: Given oidc --json is waiting, When the CLI exits, Then its owned Event is canceled", async () => {
    const child = spawnOidcCli();
    const resultPromise = waitForChild(child);

    await waitForCondition(() =>
      handles!.store.getEvents().some((event) => event.status === "pending"),
    );
    const pending = handles!.store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("configure-trust");

    child.kill("SIGTERM");

    const result = await resultPromise;
    expect(result.code).toBe(143);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    await waitForCondition(() => handles!.store.getEvent(pending!.id)?.status === "canceled");
    expect(handles!.store.getEvent(pending!.id)?.result).toBe(
      "OIDC canceled because the CLI client disconnected.",
    );
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
