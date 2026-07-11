/// <reference types="node" />

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

let server: ChildProcessWithoutNullStreams;
let origin = "";
let serverLog = "";
const browserSession = "pnpm-pub-trusted-publishing-removal-ci";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("No free port."));
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`WebUI exited early.\n${serverLog}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the Vite server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.\n${serverLog}`);
}

async function runBrowser(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "agent-browser", ...args], {
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agent-browser timed out: ${args.join(" ")}`));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`agent-browser failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

function parseBrowserJson(output: string): Record<string, unknown> {
  const line = output.split("\n").filter(Boolean).at(-1) ?? "{}";
  const parsed: unknown = JSON.parse(line);
  const value: unknown = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid browser result: ${output}`);
  }
  return value as Record<string, unknown>;
}

async function state(): Promise<Record<string, unknown>> {
  const output = await runBrowser([
    "--session",
    browserSession,
    "eval",
    `(() => {
      const review = document.querySelector('[data-testid="removal-review"]');
      const footer = document.querySelector('[data-testid="removal-footer"]');
      const group = document.querySelector('[data-testid="removal-group"]');
      const buttons = (root, label) => [...(root?.querySelectorAll('button') ?? [])]
        .filter((button) => button.textContent?.trim() === label);
      const confirm = buttons(footer, 'Confirm')[0];
      const reject = buttons(footer, 'Reject')[0];
      const groupConfirm = buttons(group, 'Confirm all')[0];
      return JSON.stringify({
        keepPressed: buttons(review, 'Keep').map((button) => button.getAttribute('data-state')),
        removePressed: buttons(review, 'Remove').map((button) => button.getAttribute('data-state')),
        confirmDisabled: confirm?.disabled ?? null,
        rejectDisabled: reject?.disabled ?? null,
        groupConfirmDisabled: groupConfirm?.disabled ?? null,
        folderActions: group?.querySelectorAll('button[aria-label="Open folder"]').length ?? 0,
        npmActions: group?.querySelectorAll('button[aria-label="Open on npm"]').length ?? 0,
      });
    })()`,
  ]);
  return parseBrowserJson(output);
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(
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
      String(port),
      "--strictPort",
    ],
    { env: { ...process.env, FORCE_COLOR: "0" } },
  );
  server.stdout.on("data", (chunk: Buffer) => (serverLog += chunk.toString("utf8")));
  server.stderr.on("data", (chunk: Buffer) => (serverLog += chunk.toString("utf8")));
  await waitForServer(`${origin}/trusted-publishing-removal-test`);
}, 30_000);

afterAll(async () => {
  await runBrowser(["--session", browserSession, "close"]).catch(() => undefined);
  if (!server || server.exitCode !== null) return;
  server.kill("SIGINT");
});

describe("Feature: per-config Trusted Publishing removal review", () => {
  it("Scenario: Given standalone and grouped removal surfaces, When reviewed, Then decisions and links obey the removal law", async () => {
    await runBrowser([
      "--session",
      browserSession,
      "open",
      `${origin}/trusted-publishing-removal-test`,
    ]);
    await runBrowser(["--session", browserSession, "wait", "--load", "networkidle"]);

    expect(await state()).toMatchObject({
      keepPressed: ["off", "off"],
      removePressed: ["on", "on"],
      confirmDisabled: false,
      rejectDisabled: false,
      groupConfirmDisabled: false,
      folderActions: 1,
      npmActions: 0,
    });

    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `[...document.querySelectorAll('[data-testid="removal-review"] button')]
        .filter((button) => button.textContent?.trim() === 'Keep')
        .forEach((button) => button.click())`,
    ]);
    expect(await state()).toMatchObject({
      keepPressed: ["on", "on"],
      confirmDisabled: true,
      rejectDisabled: false,
    });

    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `[...document.querySelectorAll('[data-testid="removal-review"] button')]
        .find((button) => button.textContent?.trim() === 'Remove')?.click()`,
    ]);
    expect(await state()).toMatchObject({
      keepPressed: ["off", "on"],
      removePressed: ["on", "off"],
      confirmDisabled: false,
      rejectDisabled: false,
    });

    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `[...document.querySelectorAll('[data-testid="removal-group"] button')]
        .find((button) => button.textContent?.includes('@scope/a'))?.click()`,
    ]);
    await runBrowser(["--session", browserSession, "wait", "--text", "@scope/a"]);
    const dialogOutput = await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const dialog = document.querySelector('[data-slot="dialog-content"]');
        const labels = [...(dialog?.querySelectorAll('button') ?? [])]
          .map((button) => button.textContent?.trim());
        return JSON.stringify({
          currentConfigs: dialog?.textContent?.includes('Current Trusted Publishing Configs') ?? false,
          keepActions: labels.filter((label) => label === 'Keep').length,
          removeActions: labels.filter((label) => label === 'Remove').length,
          removePressed: [...(dialog?.querySelectorAll('button') ?? [])]
            .filter((button) => button.textContent?.trim() === 'Remove')
            .map((button) => button.getAttribute('data-state')),
        });
      })()`,
    ]);
    expect(parseBrowserJson(dialogOutput)).toMatchObject({
      currentConfigs: true,
      keepActions: 2,
      removeActions: 2,
      removePressed: ["on", "on"],
    });
  }, 90_000);
});
