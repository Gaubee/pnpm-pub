import { describe, expect, it, vi } from "vite-plus/test";
import path from "node:path";
import { AppUpdateService, compareVersions, updateCommand, type UpdateProcess } from "../../src/daemon/app-update.js";

const packageRoot = path.resolve("/tmp", "pnpm-pub-global", "pnpm-pub");

function processFor(outputs: Record<string, string>): UpdateProcess {
  return {
    execFile: async (command, args) => {
      const output = outputs[`${command} ${args.join(" ")}`];
      if (output === undefined) throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      return { stdout: output };
    },
  };
}

function managerResolver(command: string): Promise<string | null> {
  const commands: Record<string, string> = {
    npm: "/bin/npm",
    pnpm: "/bin/pnpm",
    yarn: "/bin/yarn",
    bun: "/bin/bun",
    volta: "/bin/volta",
    vp: "/bin/vp",
  };
  return Promise.resolve(commands[command] ?? null);
}

describe("Feature: daemon-owned app update checks", () => {
  it("Scenario: Given a verified npm global package root, When latest is newer, Then the daemon exposes an installable update and persists its daily cadence", async () => {
    let now = 1_000;
    const service = new AppUpdateService({
      currentVersion: "1.0.0",
      packageRoot,
      cachePath: path.join("/tmp", `pnpm-pub-update-${process.pid}-${Date.now()}.json`),
      now: () => now,
      resolveCommandPath: managerResolver,
      process: processFor({
        "/bin/npm root --global": path.dirname(packageRoot),
        "/bin/npm --version": "11.0.0\n",
        "/bin/pnpm --version": "10.0.0\n",
      }),
      fetch: async () => new Response(JSON.stringify({ version: "1.1.0" }), { status: 200 }),
    });

    const snapshot = await service.check();
    expect(snapshot.status).toBe("available");
    expect(snapshot.owner).toMatchObject({ manager: "npm", canUpdate: true, packageRoot });
    expect(snapshot.nextCheckAt).toBe(now + 24 * 60 * 60 * 1000);
    let installRequest: { manager: string; executable: string } | null = null;
    const installService = new AppUpdateService({
      currentVersion: "1.0.0",
      packageRoot,
      cachePath: path.join("/tmp", `pnpm-pub-update-install-${process.pid}-${Date.now()}.json`),
      resolveCommandPath: managerResolver,
      process: processFor({
        "/bin/npm root --global": path.dirname(packageRoot),
        "/bin/npm --version": "11.0.0\n",
        "/bin/pnpm --version": "10.0.0\n",
      }),
      fetch: async () => new Response(JSON.stringify({ version: "1.1.0" }), { status: 200 }),
      runInstallWorker: (request) => {
        installRequest = request;
        return Promise.resolve();
      },
    });
    await installService.check();
    expect(await installService.startInstall()).toEqual({ ok: true });
    await waitForStatus(installService, "ready-to-restart");
    expect(installRequest).toMatchObject({ manager: "npm", executable: "/bin/npm" });
    installService.stop();
  });

  it("Scenario: Given an unavailable registry, When a check fails, Then the retry eligibility is one hour instead of one day", async () => {
    const now = 2_000;
    const service = new AppUpdateService({
      currentVersion: "1.0.0",
      cachePath: path.join("/tmp", `pnpm-pub-update-error-${process.pid}-${Date.now()}.json`),
      now: () => now,
      resolveCommandPath: async () => null,
      fetch: async () => new Response("offline", { status: 503 }),
    });
    const snapshot = await service.check();
    expect(snapshot.status).toBe("error");
    expect(snapshot.nextCheckAt).toBe(now + 60 * 60 * 1000);
  });

  it("Scenario: Given concurrent manual checks, When the registry request is pending, Then one request supplies every caller", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    let calls = 0;
    const service = new AppUpdateService({
      currentVersion: "1.0.0",
      cachePath: path.join("/tmp", `pnpm-pub-update-flight-${process.pid}-${Date.now()}.json`),
      resolveCommandPath: async () => null,
      fetch: () => {
        calls += 1;
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });
    const first = service.check();
    const second = service.check();
    expect(calls).toBe(1);
    resolveFetch?.(new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 }));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("Scenario: Given a package root that no global manager proves, When an update exists, Then it remains informational and cannot be installed", async () => {
    const service = new AppUpdateService({
      currentVersion: "1.0.0",
      packageRoot,
      cachePath: path.join("/tmp", `pnpm-pub-update-owner-${process.pid}-${Date.now()}.json`),
      resolveCommandPath: managerResolver,
      process: processFor({
        "/bin/npm root --global": "/another/global/root\n",
        "/bin/npm --version": "11.0.0\n",
        "/bin/pnpm --version": "10.0.0\n",
      }),
      fetch: async () => new Response(JSON.stringify({ version: "1.1.0" }), { status: 200 }),
    });
    const snapshot = await service.check();
    expect(snapshot.status).toBe("available");
    expect(snapshot.owner.canUpdate).toBe(false);
    expect(await service.startInstall()).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("Scenario: Given supported package managers, When an install command is requested, Then every command is fixed argv without a shell", () => {
    expect(updateCommand("npm")).toEqual(["install", "--global", "pnpm-pub@latest"]);
    expect(updateCommand("pnpm")).toEqual(["add", "--global", "pnpm-pub@latest"]);
    expect(updateCommand("yarn")).toEqual(["global", "add", "pnpm-pub@latest"]);
    expect(updateCommand("bun")).toEqual(["add", "--global", "pnpm-pub@latest"]);
    expect(updateCommand("volta")).toEqual(["install", "pnpm-pub@latest"]);
    expect(updateCommand("vp")).toEqual(["add", "--global", "pnpm-pub@latest"]);
  });

  it("Scenario: Given stable and prerelease versions, When comparing them, Then stable semver ordering drives availability", () => {
    expect(compareVersions("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("Scenario: Given an update worker failure, When logs arrive and retry succeeds, Then the daemon preserves evidence and reaches restart readiness", async () => {
    let attempts = 0;
    const service = updateReadyService({
      runInstallWorker: async (_request, onLog) => {
        attempts += 1;
        onLog(`attempt ${attempts}\ndownloading`);
        if (attempts === 1) throw new Error("network unavailable");
        onLog("installed");
      },
    });
    await service.check();

    await expect(service.startInstall()).resolves.toEqual({ ok: true });
    await waitForStatus(service, "install-failed");
    expect(service.getSnapshot()).toMatchObject({
      status: "install-failed",
      logs: ["attempt 1", "downloading", "network unavailable"],
    });

    await expect(service.startInstall()).resolves.toEqual({ ok: true });
    await waitForStatus(service, "ready-to-restart");
    expect(service.getSnapshot()).toMatchObject({
      status: "ready-to-restart",
      logs: ["attempt 2", "downloading", "installed"],
    });
    service.stop();
  });

  it("Scenario: Given a successful update, When the restart countdown is cancelled, Then no automatic restart occurs and manual restart remains available", async () => {
    let now = 5_000;
    let restartWorkers = 0;
    let restartRequests = 0;
    const service = updateReadyService({
      now: () => now,
      runInstallWorker: async (_request, onLog) => onLog("installed"),
      startRestartWorker: () => {
        restartWorkers += 1;
      },
      onRestartRequested: () => {
        restartRequests += 1;
      },
    });
    await service.check();
    await service.startInstall();
    await waitForStatus(service, "ready-to-restart");
    expect(service.getSnapshot().restartAt).toBe(15_000);

    await expect(service.cancelRestart()).resolves.toEqual({ ok: true });
    expect(service.getSnapshot().restartAt).toBeNull();
    expect(restartWorkers).toBe(0);

    now = 20_000;
    await expect(service.restartNow()).resolves.toEqual({ ok: true });
    expect(restartWorkers).toBe(1);
    expect(restartRequests).toBe(1);
    service.stop();
  });

  it("Scenario: Given concurrent install requests, When the worker is pending, Then one worker supplies every caller", async () => {
    let finish: (() => void) | undefined;
    let workers = 0;
    const service = updateReadyService({
      runInstallWorker: () => {
        workers += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    await service.check();
    const first = service.startInstall();
    const second = service.startInstall();
    await Promise.all([first, second]);
    expect(workers).toBe(1);
    finish?.();
    await waitForStatus(service, "ready-to-restart");
    service.stop();
  });

  it("Scenario: Given a ready update, When ten seconds elapse, Then one automatic restart source is invoked", async () => {
    vi.useFakeTimers();
    try {
      let restartWorkers = 0;
      let restartRequests = 0;
      const service = updateReadyService({
        now: Date.now,
        runInstallWorker: async () => undefined,
        startRestartWorker: () => {
          restartWorkers += 1;
        },
        onRestartRequested: () => {
          restartRequests += 1;
        },
      });
      await service.check();
      await service.startInstall();
      await waitForStatus(service, "ready-to-restart");

      await vi.advanceTimersByTimeAsync(10_000);
      expect(restartWorkers).toBe(1);
      expect(restartRequests).toBe(1);

      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Scenario: Given concurrent restart sources, When restart is pending, Then one worker handles every caller", async () => {
    let releaseRestart: (() => void) | undefined;
    let restartWorkers = 0;
    const service = updateReadyService({
      runInstallWorker: async () => undefined,
      startRestartWorker: () => {
        restartWorkers += 1;
      },
      onRestartRequested: () =>
        new Promise<void>((resolve) => {
          releaseRestart = resolve;
        }),
    });
    await service.check();
    await service.startInstall();
    await waitForStatus(service, "ready-to-restart");

    const automatic = service.restartNow();
    const manual = service.restartNow();
    expect(restartWorkers).toBe(1);
    releaseRestart?.();
    await expect(Promise.all([automatic, manual])).resolves.toEqual([{ ok: true }, { ok: true }]);
    service.stop();
  });
});

async function waitForStatus(
  service: AppUpdateService,
  status: ReturnType<AppUpdateService["getSnapshot"]>["status"],
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (service.getSnapshot().status === status) return;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  throw new Error(`update status did not reach ${status}`);
}

function updateReadyService(
  overrides: Pick<
    ConstructorParameters<typeof AppUpdateService>[0],
    "now" | "runInstallWorker" | "startRestartWorker" | "onRestartRequested"
  >,
): AppUpdateService {
  return new AppUpdateService({
    currentVersion: "1.0.0",
    packageRoot,
    cachePath: path.join("/tmp", `pnpm-pub-update-lifecycle-${process.pid}-${Date.now()}-${Math.random()}.json`),
    resolveCommandPath: managerResolver,
    process: processFor({
      "/bin/npm root --global": path.dirname(packageRoot),
      "/bin/npm --version": "11.0.0\n",
      "/bin/pnpm --version": "10.0.0\n",
    }),
    fetch: async () => new Response(JSON.stringify({ version: "1.1.0" }), { status: 200 }),
    ...overrides,
  });
}
