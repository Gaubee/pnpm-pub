import { consumeEventIterator, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DaemonStore } from "../../src/daemon/store.js";
import { PublishScheduler } from "../../src/daemon/scheduler.js";
import { WebServer } from "../../src/daemon/web-server.js";
import { kvSet } from "../../src/daemon/event-db.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { type WebRpcContract, type PackagesListFrame } from "../../src/shared/orpc-contract.js";
import type { WsServerMessage } from "../../src/shared/index.js";

const mocks = vi.hoisted(() => ({
  listMaintainerPackages: vi.fn(),
}));

vi.mock("../../src/daemon/npm-packages.js", () => ({
  listMaintainerPackages: mocks.listMaintainerPackages,
}));

type WebClient = ContractRouterClient<WebRpcContract>;

const sandbox = path.join(os.tmpdir(), `pnpm-pub-orpc-${process.pid}-${Date.now()}`);
const WEB_TOKEN = "orpc-webtoken";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function openSocket(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/rpc?token=${token}`);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
    setTimeout(() => reject(new Error("socket timeout")), 3_000);
  });
}

function isApiTombstone(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false &&
    "error" in value &&
    typeof value.error === "string"
  );
}

async function openClient(port: number): Promise<{ ws: WebSocket; client: WebClient }> {
  const ws = await openSocket(port, WEB_TOKEN);
  const link = new RPCLink({ websocket: ws });
  return { ws, client: createORPCClient<WebClient>(link) };
}

describe("Feature: WebUI oRPC WebSocket transport", () => {
  let store: DaemonStore;
  let web: WebServer | null = null;
  let port = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await fsp.rm(sandbox, { recursive: true, force: true });
    await fsp.mkdir(sandbox, { recursive: true });
    setHomeOverride(sandbox);
    store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "https://registry.npmjs.org/" });
    web = new WebServer({
      store,
      scheduler: new PublishScheduler(store),
      webToken: WEB_TOKEN,
      webuiDir: sandbox,
    });
    port = await web.start(0);
  });

  afterEach(async () => {
    await web?.stop();
    web = null;
    store.close();
    setHomeOverride(null);
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it("Scenario: Given a bad WebToken, When opening /ws/rpc, Then the socket is rejected before RPC", async () => {
    await expect(openSocket(port, "bad-token")).rejects.toThrow("socket failed");
  });

  it("Scenario: Given an obsolete /api request, When the WebUI calls it, Then the daemon returns the oRPC tombstone", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/profiles`);
    expect(response.status).toBe(404);
    const body: unknown = await response.json();
    expect(isApiTombstone(body)).toBe(true);
    if (!isApiTombstone(body)) throw new Error("Invalid API tombstone response");
    expect(body.error).toBe("The WebUI API is served over /ws/rpc.");
  });

  it("Scenario: Given a valid WebToken, When subscribing, Then initial state frames arrive over oRPC", async () => {
    const { ws, client } = await openClient(port);
    const frames: WsServerMessage[] = [];
    let streamError: unknown = null;
    const stop = consumeEventIterator(client.state.subscribe(), {
      onEvent(frame) {
        frames.push(frame);
      },
      onError(error) {
        if (!isAbortError(error)) streamError = error;
      },
    });
    await vi.waitFor(() => {
      expect(frames.some((frame) => frame.type === "profiles")).toBe(true);
      expect(frames.some((frame) => frame.type === "workspaces")).toBe(true);
    });
    await stop().catch((error: unknown) => {
      if (!isAbortError(error)) throw error;
    });
    expect(streamError).toBeNull();
    ws.close();
  });

  it("Scenario: Given a daemon package snapshot, When listing packages, Then local data renders before registry truth", async () => {
    const db = store.getEventDb();
    expect(db).toBeTruthy();
    kvSet(
      db!,
      "packages:alice@https://registry.npmjs.org/",
      {
        updatedAt: 100,
        items: [
          {
            name: "local-pkg",
            version: "1.0.0",
            description: null,
            repository: null,
            date: "2026-01-01T00:00:00.000Z",
            scope: null,
            keywords: [],
            score: 0,
          },
        ],
      },
      60_000,
    );
    mocks.listMaintainerPackages.mockResolvedValueOnce([
      {
        name: "registry-pkg",
        version: "2.0.0",
        description: null,
        repository: null,
        date: "2026-02-01T00:00:00.000Z",
        scope: null,
        keywords: [],
        score: 1,
      },
    ]);

    const { ws, client } = await openClient(port);
    const iterator = await client.packages.list({ q: "", sort: "name", page: 0, pageSize: 20 });
    const local = await iterator.next();
    const registry = await iterator.next();
    await iterator.return?.().catch((error: unknown) => {
      if (!isAbortError(error)) throw error;
    });
    ws.close();

    expect(local.value).toMatchObject({ ok: true, source: "local" });
    const localFrame = local.value as PackagesListFrame;
    expect(localFrame && localFrame.ok ? localFrame.items[0]?.name : "").toBe("local-pkg");
    expect(registry.value).toMatchObject({ ok: true, source: "registry" });
    const registryFrame = registry.value as PackagesListFrame;
    expect(registryFrame && registryFrame.ok ? registryFrame.items[0]?.name : "").toBe(
      "registry-pkg",
    );
  });
});
