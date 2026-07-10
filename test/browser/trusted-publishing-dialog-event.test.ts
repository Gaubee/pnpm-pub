/**
 * Feature: Trusted Publishing current-config dialog
 *
 * Regression: existing configs stay projection-only for npm `/trust` writes:
 * show the current trusted publisher, offer Config / Remove Event creation,
 * and keep local OIDC workflow preview out unless the caller has a package path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

let server: ChildProcessWithoutNullStreams;
let origin: string;
let serverLog = "";
const browserSession = "pnpm-pub-trusted-publishing-dialog-ci";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a TCP port."));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`WebUI dev server exited early with code ${server.exitCode}.\n${serverLog}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for WebUI dev server. Last error: ${String(lastError)}\n${serverLog}`,
  );
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
      // This repo standardizes on vite-plus (`vp`), not stock `vite` — see
      // webui/package.json `"dev": "vp dev"`.
      "vp",
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
  server.stdout.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString("utf8");
  });
  server.stderr.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString("utf8");
  });
  await waitForServer(`${origin}/trusted-publishing-dialog-test`);
}, 30_000);

afterAll(async () => {
  await runAgentBrowser(["--session", browserSession, "close"]).catch(() => undefined);
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGINT");
    setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
});

async function runAgentBrowser(args: string[]): Promise<string> {
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
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`agent-browser failed (${code}): ${args.join(" ")}\n${stdout}\n${stderr}`));
    });
  });
}

function lastOutputLine(output: string): string {
  return (
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function parseAgentBrowserJson(output: string): unknown {
  const parsed: unknown = JSON.parse(lastOutputLine(output));
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
}

async function openHost(): Promise<void> {
  await runAgentBrowser([
    "--session",
    browserSession,
    "open",
    `${origin}/trusted-publishing-dialog-test`,
  ]);
  await runAgentBrowser(["--session", browserSession, "wait", "--load", "networkidle"]);
}

interface DialogState {
  currentVisible: boolean;
  hasCurrentHeading: boolean;
  hasWorkflowTab: boolean;
  hasConfig: boolean;
  hasRemove: boolean;
  text: string;
}

/** Snapshot the current-config dialog body. */
async function readDialogState(): Promise<DialogState> {
  const output = await runAgentBrowser([
    "--session",
    browserSession,
    "eval",
    `(() => {
			const dialog = document.querySelector('[data-slot="dialog-content"]');
			const text = dialog?.textContent || '';
			const buttons = Array.from(dialog?.querySelectorAll('button') ?? [], (button) => button.textContent?.trim() ?? '');
				return JSON.stringify({
					// The current config renders as a multiline TrustedPublishingReadonly
					// (Label: Value rows) inside this dialog. The owner/repo appear as
					// separate field values, so match them independently.
					currentVisible: (text.includes('myorg') && text.includes('myrepo')) || text.includes('GitHub'),
			hasCurrentHeading: text.includes('Current Trusted Publishing Configs'),
			hasWorkflowTab: buttons.includes('Workflow'),
				hasConfig: buttons.includes('Config'),
				hasRemove: buttons.includes('Remove Trusted Publishing'),
				text,
			});
		})()`,
  ]);
  const value = parseAgentBrowserJson(output);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid dialog state: ${JSON.stringify(value)}`);
  }
  const v = value as Record<string, unknown>;
  return {
    currentVisible: !!v.currentVisible,
    hasCurrentHeading: !!v.hasCurrentHeading,
    hasWorkflowTab: !!v.hasWorkflowTab,
    hasConfig: !!v.hasConfig,
    hasRemove: !!v.hasRemove,
    text: typeof v.text === "string" ? v.text : "",
  };
}

async function openDialog(): Promise<void> {
  // The test host mounts the dialog open by default.
  const deadline = Date.now() + 5_000;
  let lastText = "";
  while (Date.now() < deadline) {
    const output = await runAgentBrowser([
      "--session",
      browserSession,
      "eval",
      `(() => {
				const dialog = document.querySelector('[data-slot="dialog-content"]');
				const buttons = Array.from(dialog?.querySelectorAll('button') ?? [], (button) => button.textContent?.trim() ?? '');
				return buttons.includes('Config') && buttons.includes('Remove Trusted Publishing');
			})()`,
    ]);
    if (lastOutputLine(output) === "true") return;
    const textOutput = await runAgentBrowser([
      "--session",
      browserSession,
      "eval",
      `document.querySelector('[data-slot="dialog-content"]')?.textContent || ''`,
    ]).catch((error: unknown) => String(error));
    lastText = lastOutputLine(textOutput);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dialog did not render current-config actions. Last text: ${lastText}`);
}

describe("Feature: Trusted Publishing current-config dialog", () => {
  it("Scenario: Given an existing config without a package path, When the dialog opens, Then it shows only current config actions", async () => {
    await openHost();
    await openDialog();

    const state = await readDialogState();
    expect(state.currentVisible, state.text).toBe(true);
    expect(state.hasCurrentHeading).toBe(true);
    expect(state.hasWorkflowTab, state.text).toBe(false);
    expect(state.hasConfig).toBe(true);
    expect(state.hasRemove).toBe(true);
  }, 90_000);
});
