import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EventEmitter } from "node:events";
import type { DevWebuiSpawn } from "../../scripts/dev-webui.js";

class FakeChild extends EventEmitter {
  killed = false;
  readonly label: string;
  exitCode: number | null = null;

  constructor(label: string) {
    super();
    this.label = label;
  }

  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.killed = true;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit("exit", 0, signal);
      this.emit("close", 0, signal);
    });
    return true;
  });
}

function makeSpawnSequence(...children: FakeChild[]) {
  return vi.fn<DevWebuiSpawn>((command, args, options) => {
    void command;
    void args;
    void options;
    const child = children.shift();
    if (!child) throw new Error("unexpected spawn");
    return child;
  });
}

describe("pnpm dev WebUI supervisor", () => {
  const originalExitCode = process.exitCode;
  const originalPort = process.env.PNPM_PUB_DEV_WEBUI_PORT;

  beforeEach(() => {
    process.exitCode = undefined;
    process.env.PNPM_PUB_DEV_WEBUI_PORT = "45678";
    vi.useRealTimers();
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    if (originalPort === undefined) delete process.env.PNPM_PUB_DEV_WEBUI_PORT;
    else process.env.PNPM_PUB_DEV_WEBUI_PORT = originalPort;
    vi.restoreAllMocks();
  });

  it("Scenario: Given pnpm dev starts, When the supervisor runs, Then it spawns the WebUI Vite+ atom without waiting for a build", async () => {
    const webui = new FakeChild("webui");
    const spawn = makeSpawnSequence(webui);
    const { main } = await import("../../scripts/dev-webui.js");

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    process.emit("SIGINT", "SIGINT");
    await run;

    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      [
        "--dir",
        "webui",
        "exec",
        "vp",
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        "45678",
        "--strictPort",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ PNPM_PUB_DEV_WEBUI_PORT: "45678" }),
      }),
    );
    expect(webui.kill).toHaveBeenCalledWith("SIGINT");
    expect(process.exitCode).toBe(0);
  });

  it("Scenario: Given Ctrl-C during startup, When the supervisor handles SIGINT, Then it stops the managed WebUI child", async () => {
    const webui = new FakeChild("webui");
    const spawn = makeSpawnSequence(webui);
    const { main } = await import("../../scripts/dev-webui.js");

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    process.emit("SIGINT", "SIGINT");
    await run;

    expect(webui.kill).toHaveBeenCalledWith("SIGINT");
  });

  it("Scenario: Given the WebUI child exits by itself, When no stop was requested, Then the supervisor preserves the child exit code", async () => {
    const webui = new FakeChild("webui");
    const spawn = makeSpawnSequence(webui);
    const { main } = await import("../../scripts/dev-webui.js");

    const run = main(spawn);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    webui.exitCode = 23;
    webui.emit("exit", 23, null);
    await run;

    expect(process.exitCode).toBe(23);
  });
});
