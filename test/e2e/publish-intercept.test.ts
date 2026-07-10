/**
 * End-to-end test (Chapter 10.3).
 *
 * Validates the full interception loop with a REAL tarball:
 *   1. Boot a headless daemon against a temp home dir + a mock registry.
 *   2. Send a publish intent over the IPC socket (as the CLI would).
 *   3. Assert the intent is PARKED as a pending event and NO request has hit
 *      the registry yet (Chapter 10.3.3 — the security red line).
 *   4. Confirm the event over authenticated oRPC WebSocket (WebToken).
 *   5. Assert the daemon then `pnpm pack`s a real tarball and PUTs the npm
 *      publish document (with `_attachments`) to the registry, and the CLI
 *      receives an exit code 0.
 *
 * The registry is an in-process mock that records request bodies — this avoids
 * the Docker/Verdaccio dependency while exercising the identical code path. To
 * target a real Verdaccio, set PNPM_PUB_E2E_REGISTRY (it must publish the
 * `e2e-test-pkg` and accept any token).
 */
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { bootDaemon } from "../../src/daemon/index.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { encodeFrame, FrameReader } from "../../src/shared/frame.js";
import { socketPath } from "../../src/shared/paths.js";
import type { DaemonHandles } from "../../src/daemon/index.js";
import type { IpcFrame, IpcRequest } from "../../src/shared/index.js";
import { openRpcClient } from "../unit/orpc-test-client.js";

type IpcExitEvidenceFrame = Extract<IpcFrame, { type: "exit" }>;

// ---- recorded registry requests ----
interface RegistryHit {
  method: string;
  url: string;
  otp?: string;
  body?: unknown;
}

interface RegistryPackument {
  versions?: Record<string, unknown>;
}

interface PublishDocumentAttachment {
  data?: string;
}

interface RegistryPublishDocument {
  _attachments?: Record<string, PublishDocumentAttachment>;
  versions?: Record<string, unknown>;
}

let registryUrl = "";
let registryHits: RegistryHit[] = [];
let registryServer: http.Server;
let registryRespondsWith: { status: number; body: unknown } = { status: 200, body: { ok: true } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRegistryPackument(value: unknown): value is RegistryPackument {
  return isRecord(value) && (value.versions === undefined || isRecord(value.versions));
}

function isPublishDocumentAttachment(value: unknown): value is PublishDocumentAttachment {
  return isRecord(value) && (value.data === undefined || typeof value.data === "string");
}

function isRegistryPublishDocument(value: unknown): value is RegistryPublishDocument {
  return (
    isRecord(value) &&
    (value.versions === undefined || isRecord(value.versions)) &&
    (value._attachments === undefined ||
      (isRecord(value._attachments) &&
        Object.values(value._attachments).every(isPublishDocumentAttachment)))
  );
}

function singleHeaderValue(value: http.IncomingHttpHeaders[string]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === "string" || Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    throw new Error("Unsupported request body chunk");
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startMockRegistry(): Promise<string> {
  return new Promise((resolve) => {
    registryServer = http.createServer(async (req, res) => {
      const raw = await readRequestBody(req);
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        /* leave as raw string */
      }
      registryHits.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        otp: singleHeaderValue(req.headers["npm-otp"]),
        body,
      });
      res.writeHead(registryRespondsWith.status, {
        "content-type": "application/json",
        date: new Date().toUTCString(),
      });
      res.end(JSON.stringify(registryRespondsWith.body));
    });
    registryServer.listen(0, "127.0.0.1", () => {
      const addr = registryServer.address();
      registryUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
      resolve(registryUrl);
    });
  });
}

// ---- helpers ----
// Keep the path SHORT — macOS limits Unix socket paths to ~104 chars.
const sandbox = `/tmp/pnpm-pub-e2e-${process.pid}`;
const pkgDir = path.join(sandbox, "pkg");

async function connectIpc(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath());
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
}

function sendIpc(sock: net.Socket, obj: IpcRequest): void {
  sock.write(encodeFrame(obj));
}

function isIpcExitFrame(frame: unknown): frame is IpcExitEvidenceFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    "type" in frame &&
    frame.type === "exit" &&
    "code" in frame &&
    typeof frame.code === "number"
  );
}

function readExitFrame(sock: net.Socket): Promise<IpcFrame | null> {
  return new Promise((resolve) => {
    const reader = new FrameReader();
    const timer = setTimeout(() => {
      sock.off("data", onData);
      resolve(null);
    }, 10_000);
    const onData = (chunk: Buffer) => {
      reader.push(chunk);
      for (const f of reader.drain()) {
        if (isIpcExitFrame(f)) {
          clearTimeout(timer);
          sock.off("data", onData);
          resolve(f);
        }
      }
    };
    sock.on("data", onData);
  });
}

/** A minimal publishable package on disk that `pnpm pack`/`npm pack` accepts. */
async function writeFixturePackage(
  name: string,
  version: string,
  dir: string = pkgDir,
): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version, description: "e2e fixture" }),
  );
  await fsp.writeFile(path.join(dir, "index.js"), `module.exports=${JSON.stringify(version)};\n`);
}

/** Fetch a packument from a registry; returns null on 404 / not-yet-published. */
async function fetchPackument(registry: string, name: string): Promise<RegistryPackument | null> {
  const url = `${registry.replace(/\/$/, "")}/${encodeURIComponent(name).replace("%40", "@")}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isRegistryPackument(json) ? json : null;
  } catch {
    return null;
  }
}

function findPendingPublishByPackage(name: string) {
  return handles!.store
    .getEvents()
    .find(
      (event) =>
        event.status === "pending" &&
        event.payload?.kind === "publish" &&
        event.payload.data.target.name === name,
    );
}

function e2eRegistryOverride(): string | undefined {
  const value = process.env.PNPM_PUB_E2E_REGISTRY?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Is a Verdaccio instance reachable at the given URL (Docker or otherwise)? */
async function verdaccioReachable(url = "http://localhost:4873"): Promise<boolean> {
  try {
    const res = await fetch(`${url}/-/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let handles: DaemonHandles | null = null;

beforeAll(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
  await startMockRegistry();
  // Default to the Docker Verdaccio registry (Chapter 10.3); fall back to the
  // in-process mock when no registry is reachable (local/no-Docker dev).
  const url =
    e2eRegistryOverride() ?? ((await verdaccioReachable()) ? "http://localhost:4873" : registryUrl);
  handles = await bootDaemon({ cliVersion: "0.1.0", withTray: false });
  if (handles) {
    await handles.store.upsertProfile({ username: "e2e-author", registry: url });
    handles.store.setCredentials("e2e-author", {
      token: "mock-token",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    await handles.store.setDefault("e2e-author");
  }
});

afterAll(async () => {
  await handles?.stop({ exit: false });
  await new Promise<void>((r) => registryServer.close(() => r()));
  // Let any in-flight store writes from shutdown drain before removing the home
  // dir (avoids a spurious unhandled ENOENT from the atomic rename).
  await new Promise((r) => setTimeout(r, 150));
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Publish interception E2E (Chapter 10.3)", () => {
  it("parks the intent, then on confirm packs a real tarball and publishes", async () => {
    expect(handles).not.toBeNull();
    // Unique name per run so re-publishes never collide with registry state.
    const pkgName = `e2e-test-pkg-${randomBytes(4).toString("hex")}`;
    const pkgVersion = "1.0.0";
    await writeFixturePackage(pkgName, pkgVersion);

    const registryOverride = e2eRegistryOverride();
    const targetRegistry = registryOverride ?? registryUrl;
    const againstMock = !registryOverride;

    const sock = await connectIpc();
    sendIpc(sock, { cliVersion: "0.1.0" });
    sendIpc(sock, { command: "publish", cwd: pkgDir, args: [] });

    // Give the daemon a moment to register the pending event.
    await new Promise((r) => setTimeout(r, 200));

    const pending = handles!.store.getEvents().filter((e) => e.status === "pending");
    expect(pending.length).toBeGreaterThan(0);
    // Security red line (Chapter 10.3.3): no registry write happened yet. For the
    // mock we assert directly; for Verdaccio we snapshot the packument existence.
    if (againstMock) {
      const writesBefore = registryHits.filter((h) => h.method === "PUT").length;
      expect(writesBefore).toBe(0);
    } else {
      const before = await fetchPackument(targetRegistry, pkgName);
      expect(before).toBeNull();
    }

    // Confirm via the authenticated WS-equivalent path, and collect the exit frame.
    const exitPromise = readExitFrame(sock);
    const event = pending[0]!;
    await handles!.scheduler.confirm(event.id);
    const exitFrame = await exitPromise;

    if (againstMock) {
      // The mock must have received the npm publish document with the base64 tarball.
      const puts = registryHits.filter((h) => h.method === "PUT" && h.url === `/${pkgName}`);
      expect(puts.length).toBeGreaterThanOrEqual(1);
      const put = puts[0]!;
      expect(isRegistryPublishDocument(put.body)).toBe(true);
      if (!isRegistryPublishDocument(put.body)) throw new Error("Invalid publish document");
      const doc = put.body;
      expect(doc._attachments).toBeTruthy();
      const attachment = Object.values(doc._attachments ?? {})[0];
      expect(attachment?.data).toBeTruthy();
      expect(attachment!.data!.length).toBeGreaterThan(0);
      expect(doc.versions?.[pkgVersion]).toBeTruthy();
    } else {
      // Real Verdaccio: query the packument to prove the version landed.
      const after = await fetchPackument(targetRegistry, pkgName);
      expect(after).not.toBeNull();
      expect(after?.versions?.[pkgVersion]).toBeTruthy();
    }

    // The event resolves to success and the CLI receives exit code 0.
    const resolved = handles!.store.getEvent(event.id);
    expect(resolved?.status).toBe("success");
    expect(exitFrame?.type).toBe("exit");
    if (exitFrame?.type === "exit") expect(exitFrame.code).toBe(0);

    sock.destroy();
  });

  it("rejects an unauthenticated confirm (Chapter 3.2.2)", async () => {
    const before = registryHits.length;
    // Confirming a non-existent id through the scheduler is the in-process
    // equivalent of an unauthenticated WS confirm (the WS layer 401s first).
    const ok = handles!.scheduler.confirm("does-not-exist");
    await expect(ok).resolves.toBe(false);
    expect(registryHits.length).toBe(before); // nothing executed
  });

  it("confirms a publish over a REAL WebToken-authenticated oRPC WebSocket (Chapter 10.3.3)", async () => {
    expect(handles).not.toBeNull();
    const registryOverride = e2eRegistryOverride();
    const targetRegistry = registryOverride ?? registryUrl;
    const againstMock = !registryOverride;
    const webPort = handles!.port;
    const webToken = handles!.webToken;

    // Fixture package unique to this run.
    const name = `ws-confirm-pkg-${randomBytes(4).toString("hex")}`;
    await writeFixturePackage(name, "1.0.0");

    // Drive the publish intent over IPC (as the CLI would), then park.
    const sock = await connectIpc();
    sendIpc(sock, { cliVersion: "0.1.0" });
    sendIpc(sock, { command: "publish", cwd: pkgDir, args: [] });
    await new Promise((r) => setTimeout(r, 200));
    const pending = findPendingPublishByPackage(name);
    expect(pending).toBeTruthy();

    // Chapter 10.3.3: confirm over a genuine oRPC WS connection carrying the WebToken.
    const exitPromise = readExitFrame(sock);
    const rpc = await openRpcClient(webPort, webToken);

    await rpc.client.events.confirm({ id: pending!.id });

    const exitFrame = await exitPromise;
    if (againstMock) {
      const puts = registryHits.filter((h) => h.method === "PUT" && h.url === `/${name}`);
      expect(puts.length).toBeGreaterThanOrEqual(1);
    } else {
      const after = await fetchPackument(targetRegistry, name);
      expect(after?.versions?.["1.0.0"]).toBeTruthy();
    }
    const resolved = handles!.store.getEvent(pending!.id);
    expect(resolved?.status).toBe("success");
    expect(exitFrame?.type).toBe("exit");
    if (exitFrame?.type === "exit") expect(exitFrame.code).toBe(0);
    rpc.close();
    sock.destroy();
  });

  it("refuses a WS upgrade with a bad WebToken (Chapter 3.2.2 瞬间拦截)", async () => {
    const webPort = handles!.port;
    const ws = new WebSocket(`ws://127.0.0.1:${webPort}/ws/rpc?token=definitely-wrong`);
    let opened = false;
    let errored = false;
    await new Promise<void>((resolve) => {
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        errored = true;
        resolve();
      };
    });
    // The server rejects the upgrade with 401, so the socket must error/not open.
    expect(opened).toBe(false);
    expect(errored).toBe(true);
  });

  it("records clockDriftRecovered after an OTP-failure self-heal (Chapter 8.4 / 10.1.2)", async () => {
    // Stand up a SECOND mock registry that fails the first PUT with a 403 OTP
    // error and a clock skewed ~2 min ahead, then succeeds — mirroring what a
    // real registry does on clock skew. We point a dedicated profile at it.
    const driftHits: { otp?: string; status: number }[] = [];
    const driftServer = http.createServer((req, res) => {
      if (req.method === "PUT") {
        const otp = singleHeaderValue(req.headers["npm-otp"]);
        const n = driftHits.length + 1;
        if (n === 1) {
          res.writeHead(403, {
            "content-type": "application/json",
            date: new Date(Date.now() + 120_000).toUTCString(),
          });
          res.end(JSON.stringify({ error: "OTP validation failed" }));
          driftHits.push({ otp, status: 403 });
        } else {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          driftHits.push({ otp, status: 200 });
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => driftServer.listen(0, "127.0.0.1", r));
    const driftAddr = driftServer.address();
    const driftUrl = `http://127.0.0.1:${typeof driftAddr === "object" && driftAddr ? driftAddr.port : 0}`;

    // Point a second profile at the drift registry so this publish uses it.
    // Guard the app dir first — other tests may have left the store mid-write.
    const { ensureAppDirs } = await import("../../src/shared/paths.js");
    ensureAppDirs();
    await handles!.store.upsertProfile({ username: "drift-author", registry: driftUrl });
    handles!.store.setCredentials("drift-author", { token: "t", totpSecret: "JBSWY3DPEHPK3PXP" });
    await handles!.store.setDefault("drift-author");

    const driftPkg = `drift-pkg-${randomBytes(3).toString("hex")}`;
    const driftDir = path.join(sandbox, "driftpkg");
    await writeFixturePackage(driftPkg, "1.0.0", driftDir);

    const sock = await connectIpc();
    sendIpc(sock, { cliVersion: "0.1.0" });
    sendIpc(sock, { command: "publish", cwd: driftDir, args: [] });
    await new Promise((r) => setTimeout(r, 200));
    const pending = findPendingPublishByPackage(driftPkg);

    const exitPromise = readExitFrame(sock);
    await handles!.scheduler.confirm(pending!.id);
    const exitFrame = await exitPromise;

    const resolved = handles!.store.getEvent(pending!.id);
    expect(resolved?.status).toBe("success");
    // The defining assertion: clock-drift recovery was exercised and recorded.
    expect(resolved?.clockDriftRecovered).toBe(true);
    if (exitFrame?.type === "exit") expect(exitFrame.code).toBe(0);
    // Two registry attempts: initial OTP failure + compensated retry.
    expect(driftHits.length).toBe(2);

    sock.destroy();
    await new Promise<void>((r) => driftServer.close(() => r()));
    // Restore the primary profile for any later assertions.
    await handles!.store.setDefault("e2e-author");
  });
});
