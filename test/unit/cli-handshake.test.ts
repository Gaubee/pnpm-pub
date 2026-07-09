/**
 * CLI version-handshake loop tests (Chapter 7.2.1).
 *
 * Simulates the daemon returning the `daemon-outdated` self-destruct signal on
 * the first connection, then a fresh daemon that accepts the publish. Asserts
 * the CLI re-spawns and retries rather than failing out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import net from "node:net";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { setHomeOverride, socketPath } from "../../src/shared/paths.js";
import { encodeFrame } from "../../src/shared/frame.js";
import { FrameReader } from "../../src/shared/frame.js";
import type { IpcRequest } from "../../src/shared/index.js";
import { readExpectedPackageVersion } from "../helpers/package-version.js";

// SHORT path — macOS limits Unix socket paths to ~104 chars.
const sandbox = `/tmp/pp-cli-${process.pid}`;

// We drive the CLI's runPublish by importing main() and feeding argv. To avoid
// actually spawning node, we mock child_process.spawn to a no-op and stand up a
// real in-process IPC server that emulates the daemon's handshake behavior.

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(() => ({
      unref() {},
      on() {},
      kill() {},
    })),
  };
});

let server: net.Server;
let connectionCount = 0;
let capturedFrames: IpcRequest[] = [];
let statusProfile = "alice";

function isIpcRequest(frame: unknown): frame is IpcRequest {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (("cliVersion" in frame && typeof frame.cliVersion === "string") ||
      ("command" in frame && typeof frame.command === "string"))
  );
}

function isPublishRequest(frame: IpcRequest): frame is Extract<IpcRequest, { command: "publish" }> {
  return "command" in frame && frame.command === "publish";
}

function isOidcRequest(frame: IpcRequest): frame is Extract<IpcRequest, { command: "oidc" }> {
  return "command" in frame && frame.command === "oidc";
}

/** First connection: emit daemon-outdated; subsequent: accept & succeed. */
function makeServer(): net.Server {
  return net.createServer((socket) => {
    connectionCount++;
    const isFirst = connectionCount === 1;
    const reader = new FrameReader();
    socket.on("data", (chunk) => {
      reader.push(chunk);
      for (const frame of reader.drain()) {
        if (!isIpcRequest(frame)) continue;
        capturedFrames.push(frame);
        // First frame is always the handshake.
        if ("cliVersion" in frame) {
          if (isFirst) {
            // Old daemon: self-destruct signal.
            socket.write(encodeFrame({ type: "exit", code: 0, message: "daemon-outdated" }));
            socket.end();
          }
          continue;
        }
        if (frame.command === "status") {
          socket.write(
            encodeFrame({ type: "status", active: true, profile: statusProfile, pid: 4321 }),
          );
          socket.end();
          continue;
        }
        if (frame.command === "stop") {
          socket.write(encodeFrame({ type: "status", active: false }));
          socket.end();
          continue;
        }
        // Second connection: wait for the publish intent, then succeed.
        if (frame.command === "publish") {
          socket.write(encodeFrame({ type: "stdout", data: "publishing...\n" }));
          socket.write(encodeFrame({ type: "exit", code: 0 }));
          socket.end();
        }
        if (frame.command === "oidc") {
          socket.write(
            encodeFrame({
              type: "stdout",
              data: "[oidc] created 1 Trusted Publishing Event. Confirm in the tray.\n",
            }),
          );
          socket.write(encodeFrame({ type: "exit", code: 0 }));
          socket.end();
        }
      }
    });
  });
}

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  setHomeOverride(sandbox);
  connectionCount = 0;
  capturedFrames = [];
  statusProfile = "alice";
  // Ensure the socket parent dir exists (socketPath() lives under runDir()).
  const sock = socketPath();
  await fsp.mkdir(path.dirname(sock), { recursive: true });
  try {
    await fsp.unlink(sock);
  } catch {
    /* ignore */
  }
  server = makeServer();
  await new Promise<void>((r) => server.listen(sock, r));
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("CLI version-handshake loop (Chapter 7.2.1)", () => {
  it.each([
    ["publish --help", ["publish", "--help"], "help"],
    ["publish -h", ["publish", "-h"], "help"],
    ["publish --version", ["publish", "--version"], "version"],
  ])(
    "Scenario: Given %s, When CLI runs it, Then it exits locally without daemon IPC",
    async (_label, args, outputKind) => {
      const { main } = await import("../../src/cli/cli.js");
      const exitSpy = mockProcessExit();
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      try {
        await main(["node", "pnpm-pub", ...args]);
      } catch (err) {
        expectExitCode(err, 0);
      }

      expect(connectionCount).toBe(0);
      expect(capturedFrames).toEqual([]);
      const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
      if (outputKind === "help") {
        expect(stdout).toContain("Usage: pnpm publish");
      } else {
        expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
      }
      expect(stdoutSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Waiting for GUI confirmation"),
      );
      expect(stderrSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  );

  it("Scenario: Given the help subcommand, When CLI runs it, Then it prints pnpm-pub help without daemon IPC", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "help"]);
    } catch (err) {
      expectExitCode(err, 0);
    }

    expect(connectionCount).toBe(0);
    expect(capturedFrames).toEqual([]);
    const stdout = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("pnpm-pub help");
    expect(stdout).toContain("pnpm-pub [publish args...]");
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Waiting for GUI confirmation"),
    );
    expect(stderrSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Scenario: Given a status command, When the daemon reports an active profile, Then CLI prints that profile", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "status"]);
    } catch {
      /* ignore exit throw */
    }

    expect(capturedFrames.some((frame) => "command" in frame && frame.command === "status")).toBe(
      true,
    );
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Active profile: alice"));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Scenario: Given a profile override before publish args, When CLI sends publish, Then the override stays on the IPC request", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "--profile=work", "publish", "--dry-run"]);
    } catch {
      /* ignore exit throw */
    } finally {
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(
      capturedFrames.some((frame) => isPublishRequest(frame) && frame.profileOverride === "work"),
    ).toBe(true);
  });

  it("Scenario: Given empty --profile= before publish args, When CLI parses it, Then it fails locally before IPC", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "--profile=", "--dry-run"]);
    } catch (err) {
      expectExitCode(err, 1);
    }

    expect(connectionCount).toBe(0);
    expect(capturedFrames).toEqual([]);
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Waiting for GUI confirmation"),
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("--profile requires a value"));
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Scenario: Given -- before package args, When package args include --profile, Then CLI preserves it as a publish arg", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main([
        "node",
        "pnpm-pub",
        "--profile=work",
        "publish",
        "--",
        "--profile",
        "package-owned",
      ]);
    } catch {
      /* ignore exit throw */
    } finally {
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    const publishFrame = capturedFrames.find(isPublishRequest);
    expect(publishFrame).toBeTruthy();
    expect(publishFrame?.profileOverride).toBe("work");
    expect(publishFrame?.args).toEqual(["--", "--profile", "package-owned"]);
  });

  it("Scenario: Given a daemon-outdated signal, When CLI retries publish, Then it re-spawns and sends the package version handshake", async () => {
    const { main } = await import("../../src/cli/cli.js");
    // Capture the exit code the CLI would have used.
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "publish"]);
    } catch (e) {
      // The first connection returned daemon-outdated; the loop re-spawns
      // (no-op) and retries. The second connection publishes successfully and
      // the CLI calls process.exit(0).
      expectExitCode(e, 0);
    }

    // The server must have been contacted twice (outdated, then publish).
    expect(connectionCount).toBe(2);
    const expectedVersion = readExpectedPackageVersion();
    expect(
      capturedFrames.some((frame) => "cliVersion" in frame && frame.cliVersion === expectedVersion),
    ).toBe(true);
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Scenario: Given the oidc subcommand, When CLI sends it, Then it is an oidc IPC request instead of a publish fallback", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main([
        "node",
        "pnpm-pub",
        "oidc",
        "@scope/a",
        "--repo",
        "owner/repo",
        "--file",
        "publish.yml",
        "--json",
        "--profile",
        "work",
      ]);
    } catch (err) {
      expectExitCode(err, 0);
    }

    const oidcFrame = capturedFrames.find(isOidcRequest);
    expect(oidcFrame).toBeTruthy();
    expect(oidcFrame?.profileOverride).toBe("work");
    expect(oidcFrame?.packageNames).toEqual(["@scope/a"]);
    expect(oidcFrame?.repo).toBe("owner/repo");
    expect(oidcFrame?.file).toBe("publish.yml");
    expect(oidcFrame?.json).toBe(true);
    expect(capturedFrames.some(isPublishRequest)).toBe(false);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("[oidc] created 1"));
    expect(stderrSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("Scenario: Given invalid oidc args with --json, When parsing fails, Then stdout is structured JSON", async () => {
    const { main } = await import("../../src/cli/cli.js");
    const exitSpy = mockProcessExit();
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await main(["node", "pnpm-pub", "oidc", "--json", "--workflow", "publish.yml"]);
    } catch (err) {
      expectExitCode(err, 1);
    }

    const output = String(stdoutSpy.mock.calls[0]?.[0] ?? "");
    expect(JSON.parse(output)).toEqual({
      ok: false,
      command: "oidc",
      error: "Use --file <workflow.yml>; --workflow is not supported.",
      events: [],
    });
    expect(stderrSpy).not.toHaveBeenCalled();
    expect(capturedFrames).toEqual([]);
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

class ExitCode {
  constructor(public code: number) {}
}

function mockProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
    throw new ExitCode(readExitCode(code));
  });
}

function readExitCode(code: string | number | null | undefined): number {
  if (typeof code === "number") return code;
  if (typeof code === "string") return Number.parseInt(code, 10);
  return 0;
}

function expectExitCode(value: unknown, code: number): void {
  expect(value).toBeInstanceOf(ExitCode);
  if (!(value instanceof ExitCode)) {
    throw new Error("Expected process.exit to throw ExitCode.");
  }
  expect(value.code).toBe(code);
}
