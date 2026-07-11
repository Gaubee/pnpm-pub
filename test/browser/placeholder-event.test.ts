/// <reference types="node" />

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

let server: ChildProcessWithoutNullStreams;
let origin = "";
let serverLog = "";
const browserSession = "pnpm-pub-placeholder-event-ci";

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
      // Keep polling until Vite is ready.
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
  await waitForServer(`${origin}/placeholder-event-test`);
}, 30_000);

afterAll(async () => {
  await runBrowser(["--session", browserSession, "close"]).catch(() => undefined);
  if (!server || server.exitCode !== null) return;
  server.kill("SIGINT");
});

describe("Feature: placeholder EventCard publish parity", () => {
  it("Scenario: Given the New Action form, When a package name is typed, Then casing and validation are enforced before EventCard creation", async () => {
    await runBrowser(["--session", browserSession, "open", `${origin}/active-events`]);
    await runBrowser(["--session", browserSession, "wait", "--load", "networkidle"]);
    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('New Action'))?.click()`,
    ]);
    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const input = document.querySelector('#placeholder-package-name');
        if (!(input instanceof HTMLInputElement)) return;
        input.value = 'Invalid Package';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      })()`,
    ]);

    const invalidOutput = await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const input = document.querySelector('#placeholder-package-name');
        const create = [...document.querySelectorAll('button')]
          .find((button) => button.textContent?.trim() === 'Create placeholder');
        return JSON.stringify({
          value: input?.value ?? '',
          invalid: input?.getAttribute('aria-invalid'),
          errorVisible: document.querySelector('#placeholder-package-name-error') !== null,
          createDisabled: create?.disabled ?? null,
        });
      })()`,
    ]);
    expect(parseBrowserJson(invalidOutput)).toMatchObject({
      value: "invalid package",
      invalid: "true",
      errorVisible: true,
      createDisabled: true,
    });

    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const input = document.querySelector('#placeholder-package-name');
        if (!(input instanceof HTMLInputElement)) return;
        input.value = '@Gaubee/Reserved-Name';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      })()`,
    ]);
    const validOutput = await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const input = document.querySelector('#placeholder-package-name');
        const buttons = [...document.querySelectorAll('button')];
        return JSON.stringify({
          value: input?.value ?? '',
          invalid: input?.getAttribute('aria-invalid'),
          advancedActions: buttons.filter((button) => button.textContent?.trim() === 'Advanced').length,
          createDisabled: buttons.find((button) => button.textContent?.trim() === 'Create placeholder')?.disabled ?? null,
        });
      })()`,
    ]);
    expect(parseBrowserJson(validOutput)).toMatchObject({
      value: "@gaubee/reserved-name",
      invalid: "false",
      advancedActions: 0,
      createDisabled: false,
    });
  }, 90_000);

  it("Scenario: Given placeholder lifecycle states, When rendered, Then Advanced and completed actions match publish cards", async () => {
    await runBrowser(["--session", browserSession, "open", `${origin}/placeholder-event-test`]);
    await runBrowser(["--session", browserSession, "wait", "--load", "networkidle"]);
    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `document.querySelector('[data-testid="placeholder-pending"] button[aria-expanded="false"]')?.click()`,
    ]);

    const output = await runBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
        const pending = document.querySelector('[data-testid="placeholder-pending"]');
        const failed = document.querySelector('[data-testid="placeholder-failed"]');
        const success = document.querySelector('[data-testid="placeholder-success"]');
        const labels = (root) => [...(root?.querySelectorAll('button') ?? [])]
          .map((button) => button.textContent?.trim());
        return JSON.stringify({
          pendingText: pending?.textContent ?? '',
          publicChecked: [...(pending?.querySelectorAll('button') ?? [])]
            .find((button) => button.textContent?.trim() === 'Public')?.getAttribute('aria-checked'),
          restrictedDisabled: [...(pending?.querySelectorAll('button') ?? [])]
            .find((button) => button.textContent?.trim() === 'Restricted')?.disabled ?? null,
          pendingHasTag: pending?.textContent?.includes('Tag') ?? false,
          pendingHasIgnoreScripts: pending?.textContent?.includes('Ignore scripts') ?? false,
          failedLabels: labels(failed),
          successLabels: labels(success),
          failedNpmActions: failed?.querySelectorAll('button[aria-label="Open on npm"]').length ?? 0,
          successNpmActions: success?.querySelectorAll('button[aria-label="Open on npm"]').length ?? 0,
        });
      })()`,
    ]);

    expect(parseBrowserJson(output)).toMatchObject({
      pendingText: expect.stringContaining("@gaubee/reserved-name"),
      publicChecked: "true",
      restrictedDisabled: false,
      pendingHasTag: true,
      pendingHasIgnoreScripts: false,
      failedLabels: expect.arrayContaining(["Retry"]),
      successLabels: expect.arrayContaining(["Delete"]),
      failedNpmActions: 1,
      successNpmActions: 1,
    });

    await runBrowser([
      "--session",
      browserSession,
      "eval",
      `[...document.querySelectorAll('[data-testid="placeholder-success"] button')]
        .find((button) => button.textContent?.trim() === 'Delete')?.click()`,
    ]);
    const confirmationOutput = await runBrowser([
      "--session",
      browserSession,
      "eval",
      `JSON.stringify({ text: document.querySelector('[data-testid="placeholder-success"]')?.textContent ?? '' })`,
    ]);
    expect(parseBrowserJson(confirmationOutput)).toMatchObject({
      text: expect.stringContaining("Delete @gaubee/reserved-name?"),
    });
  }, 90_000);
});
