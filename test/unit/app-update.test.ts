import { describe, expect, it } from "vite-plus/test";
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
    expect(await service.prepareInstall()).toMatchObject({ manager: "npm", executable: "/bin/npm" });
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
    expect(await service.prepareInstall()).toMatchObject({ error: expect.any(String) });
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
});
