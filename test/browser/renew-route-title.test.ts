/**
 * Feature: Renew route rendered projection
 *
 * Scenario: Given SvelteKit serves the renew route, when a browser opens each
 * route reason, then the rendered route keeps expired-token and credential
 * re-apply projections apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

let server: ChildProcessWithoutNullStreams;
let origin: string;
let serverLog = "";
const browserSession = "pnpm-pub-renew-route-state-ci";

interface RenewRouteState {
  title: string;
  heading: string;
  submitLabel: string;
}

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
  await waitForServer(`${origin}/renew`);
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

function parseRenewRouteState(output: string): RenewRouteState {
  const value = parseAgentBrowserJson(output);
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "title" in value &&
    "heading" in value &&
    "submitLabel" in value &&
    typeof value.title === "string" &&
    typeof value.heading === "string" &&
    typeof value.submitLabel === "string"
  ) {
    return {
      title: value.title,
      heading: value.heading,
      submitLabel: value.submitLabel,
    };
  }
  throw new Error(`agent-browser returned an invalid renew route state: ${JSON.stringify(value)}`);
}

function parseAgentBrowserString(output: string): string {
  const line = lastOutputLine(output);
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    return line;
  }
}

async function openRenew(pathname: string): Promise<void> {
  await runAgentBrowser(["--session", browserSession, "open", `${origin}${pathname}`]);
  await runAgentBrowser(["--session", browserSession, "wait", "--load", "networkidle"]);
}

async function titleFor(pathname: string): Promise<string> {
  await openRenew(pathname);
  const output = await runAgentBrowser(["--session", browserSession, "get", "title"]);
  return lastOutputLine(output);
}

async function routeStateFor(pathname: string): Promise<RenewRouteState> {
  await openRenew(pathname);
  const output = await runAgentBrowser([
    "--session",
    browserSession,
    "eval",
    `JSON.stringify({
			title: document.title,
			heading: document.querySelector('h1')?.textContent?.trim() ?? '',
			submitLabel: document.querySelector('button.bg-brand.w-full')?.textContent?.trim() ?? '',
		})`,
  ]);
  return parseRenewRouteState(output);
}

async function defaultErrorFor(pathname: string): Promise<string> {
  await openRenew(pathname);
  const output = await runAgentBrowser([
    "--session",
    browserSession,
    "eval",
    `(async () => {
			window.fetch = async () => new Response(JSON.stringify({ ok: false }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
			const setInput = (selector, value) => {
				const input = document.querySelector(selector);
				if (!(input instanceof HTMLInputElement)) throw new Error(\`Missing input \${selector}\`);
				input.value = value;
				input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			};
			setInput('#u', 'alice');
			setInput('#p', 'password');
			await new Promise((resolve) => setTimeout(resolve, 0));
			const button = document.querySelector('button.bg-brand.w-full');
			if (!(button instanceof HTMLButtonElement)) throw new Error('Missing submit button');
			const enabledDeadline = Date.now() + 5000;
			while (Date.now() < enabledDeadline && button.disabled) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (button.disabled) throw new Error('Submit button stayed disabled');
			button.click();
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline) {
				const error = document.querySelector('.text-destructive')?.textContent?.trim();
				if (error) return error;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			throw new Error('Timed out waiting for fallback error');
		})()`,
  ]);
  return parseAgentBrowserString(output);
}

describe("Feature: Renew route rendered projection", () => {
  it("Scenario: Given renew route reasons, When a browser opens the routes, Then only expired routes say Renew Token", async () => {
    await expect(titleFor("/renew?reason=expired")).resolves.toBe("Renew Token · pnpm-pub");
    await expect(titleFor("/renew?reason=action-required")).resolves.toBe(
      "Re-apply Credentials · pnpm-pub",
    );
    await expect(titleFor("/renew")).resolves.toBe("Re-apply Credentials · pnpm-pub");
  }, 90_000);

  it("Scenario: Given renew route reasons, When rendered in a browser, Then heading and submit label follow the route source", async () => {
    await expect(routeStateFor("/renew?reason=expired")).resolves.toEqual({
      title: "Renew Token · pnpm-pub",
      heading: "Renew Token",
      submitLabel: "Renew token",
    });
    await expect(routeStateFor("/renew?reason=action-required")).resolves.toEqual({
      title: "Re-apply Credentials · pnpm-pub",
      heading: "Re-apply Credentials",
      submitLabel: "Re-apply credentials",
    });
    await expect(routeStateFor("/renew")).resolves.toEqual({
      title: "Re-apply Credentials · pnpm-pub",
      heading: "Re-apply Credentials",
      submitLabel: "Re-apply credentials",
    });
  }, 90_000);

  it("Scenario: Given no authenticated daemon client, When submitted in a browser, Then the transport fallback stays distinct from renew projection copy", async () => {
    await expect(defaultErrorFor("/renew?reason=expired")).resolves.toBe(
      "Invalid daemon response.",
    );
    await expect(defaultErrorFor("/renew?reason=action-required")).resolves.toBe(
      "Invalid daemon response.",
    );
    await expect(defaultErrorFor("/renew")).resolves.toBe("Invalid daemon response.");
  }, 90_000);
});
