/**
 * Feature: WebUI-created proactive events
 *
 * Scenario: Given a workspace action creates a Trusted Publishing event, when the user
 * confirms it, then the scheduler executes it through the same pending wall as
 * CLI-originated publish events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DaemonStore } from "../../src/daemon/store.js";
import { PublishScheduler } from "../../src/daemon/scheduler.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import type { TrustedPublisherConfig } from "../../src/shared/index.js";
import { publishPackage } from "../../src/daemon/npm-api.js";
import {
  addTrustedPublisher,
  listTrustedPublishers,
  removeTrustedPublisher,
} from "../../src/daemon/trusted-publishing-api.js";
import {
  packPackage,
  readPackageTarball,
  summarizePackageTarball,
} from "../../src/daemon/packer.js";
import {
  publishPackageViaCli,
  publishRecursiveViaCli,
  listRecursivePackages,
  hasPnpm,
  PnpmNotOnPathError,
} from "../../src/daemon/publisher.js";

vi.mock("../../src/daemon/npm-api.js", () => ({
  publishPackage: vi.fn(),
}));

vi.mock("../../src/daemon/trusted-publishing-api.js", () => ({
  addTrustedPublisher: vi.fn(),
  removeTrustedPublisher: vi.fn(),
  // Pre-flight lookup: default to "no existing config" so the add path POSTs
  // directly. Tests that exercise the update/conflict path override this.
  listTrustedPublishers: vi.fn(),
}));

vi.mock("../../src/daemon/packer.js", () => ({
  packPackage: vi.fn(),
  readPackageTarball: vi.fn(),
  summarizePackageTarball: vi.fn(),
}));

vi.mock("../../src/daemon/publisher.js", () => ({
  publishPackageViaCli: vi.fn(),
  publishRecursiveViaCli: vi.fn(),
  listRecursivePackages: vi.fn(),
  hasPnpm: vi.fn(),
  PnpmNotOnPathError: class PnpmNotOnPathError extends Error {},
}));

const sandbox = path.join(os.tmpdir(), `pnpm-pub-proactive-${process.pid}-${Date.now()}`);
const addTrustedPublisherMock = vi.mocked(addTrustedPublisher);
const removeTrustedPublisherMock = vi.mocked(removeTrustedPublisher);
const listTrustedPublishersMock = vi.mocked(listTrustedPublishers);
const publishPackageMock = vi.mocked(publishPackage);
const packPackageMock = vi.mocked(packPackage);
const readPackageTarballMock = vi.mocked(readPackageTarball);
const summarizePackageTarballMock = vi.mocked(summarizePackageTarball);
const publishPackageViaCliMock = vi.mocked(publishPackageViaCli);
const publishRecursiveViaCliMock = vi.mocked(publishRecursiveViaCli);
const listRecursivePackagesMock = vi.mocked(listRecursivePackages);
const hasPnpmMock = vi.mocked(hasPnpm);
const execFileAsync = promisify(execFile);

function parseMockPackageMetadata(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

beforeEach(async () => {
  vi.resetAllMocks();
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
  addTrustedPublisherMock.mockResolvedValue({
    ok: true,
    status: 200,
  });
  removeTrustedPublisherMock.mockResolvedValue({ ok: true, status: 200 });
  // Pre-flight lookup defaults to "no existing config" so the add path POSTs
  // directly. Tests exercising update/conflict override this to return an
  // existing config.
  listTrustedPublishersMock.mockResolvedValue({ ok: true, configs: [] });
  publishPackageMock.mockResolvedValue({
    ok: true,
    status: 200,
    stdout: "[publish] + reserved-name@0.0.0",
    stderr: "",
  });
  // Default: pnpm absent from PATH → scheduler falls back to the registry-API
  // path, so these tests assert against publishPackageMock (the API path) as
  // before. Individual tests override this to exercise the CLI primary path.
  publishPackageViaCliMock.mockRejectedValue(new PnpmNotOnPathError());
  // Default: pnpm absent for recursive enumeration too.
  hasPnpmMock.mockResolvedValue(false);
  listRecursivePackagesMock.mockResolvedValue([]);
  packPackageMock.mockImplementation(async (cwd: string) => {
    const metadata = parseMockPackageMetadata(
      await fsp.readFile(path.join(cwd, "package.json"), "utf8"),
    );
    return {
      tarball: Buffer.from("placeholder tarball"),
      metadata,
    };
  });
  readPackageTarballMock.mockImplementation(async (file: string) => {
    const metadata = parseMockPackageMetadata(await fsp.readFile(`${file}.package.json`, "utf8"));
    return {
      tarball: await fsp.readFile(file),
      metadata,
    };
  });
  summarizePackageTarballMock.mockRejectedValue(new Error("invalid mock tarball"));
});

afterEach(async () => {
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Feature: WebUI-created proactive events", () => {
  it("Scenario: Given a configure-trust event, When confirmed, Then it executes from the pending wall", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const config = {
      type: "github" as const,
      permissions: ["createPackage" as const],
      claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
    };
    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "add",
      target: { name: "@scope/pkg", repository: "owner/repo" },
      config,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    expect(addTrustedPublisherMock).toHaveBeenCalledWith(
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/pkg",
      config,
    );

    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("success");
  });

  it("Scenario: Given an Events action input, When it is submitted, Then the payload is source-backed and not a demo literal", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("create-placeholder", "alice", {
      name: "reserved-name",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const evt = store.getEvent(created.event.id);
    expect(evt?.payload?.kind).toBe("create-placeholder");
    if (evt?.payload?.kind !== "create-placeholder") return;
    expect(evt.payload.data.name).toBe("reserved-name");
  });

  it("Scenario: Given scanned package metadata, When routed from Workspaces, Then the trust repo comes from the package source", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "add",
      target: { name: "@scope/pkg", repository: "acme/repo", path: "/workspace/pkg" },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.event.payload?.kind).toBe("configure-trust");
    if (created.event.payload?.kind !== "configure-trust") return;
    expect(created.event.payload.data.target.repository).toBe("acme/repo");
  });

  it("Scenario: Given a WebUI-created publish event, When rejected, Then no registry action runs", async () => {
    const packageDir = path.join(sandbox, "publish-reject-detached");
    await fsp.mkdir(packageDir, { recursive: true });

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("publish", "alice", {
      source: { kind: "directory", path: packageDir },
      args: [],
      target: { name: "pkg", version: "1.0.0", path: packageDir },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(scheduler.reject(created.event.id)).toBe(true);
    expect(store.getEvent(created.event.id)?.status).toBe("rejected");
    expect(publishPackageMock).not.toHaveBeenCalled();
  });

  it("Scenario: Given a WebUI-created publish event, When canceled before confirmation, Then no registry action runs", async () => {
    const packageDir = path.join(sandbox, "publish-cancel-detached");
    await fsp.mkdir(packageDir, { recursive: true });

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("publish", "alice", {
      source: { kind: "directory", path: packageDir },
      args: [],
      target: { name: "pkg", version: "1.0.0", path: packageDir },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(scheduler.cancel(created.event.id, "owner disappeared")).toBe(true);
    expect(store.getEvent(created.event.id)?.status).toBe("canceled");
    expect(store.getEvent(created.event.id)?.result).toBe("owner disappeared");
    expect(publishPackageMock).not.toHaveBeenCalled();
  });

  it("Scenario: Given confirmation has started an external publish, When cancellation arrives, Then it does not rewrite the result", async () => {
    const packageDir = path.join(sandbox, "publish-cancel-after-confirm");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("publish", "alice", {
      source: { kind: "directory", path: packageDir },
      args: ["--dry-run", "--no-git-checks"],
      target: { name: "pkg", version: "1.0.0", path: packageDir },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const confirmed = scheduler.confirm(created.event.id);
    expect(scheduler.cancel(created.event.id, "owner disappeared")).toBe(false);
    await expect(confirmed).resolves.toBe(true);
    expect(store.getEvent(created.event.id)?.status).toBe("success");
  });

  it("Scenario: Given an existing trusted publisher that differs, When update is confirmed, Then the old id is deleted before the new config is added (delete-then-put)", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const config = {
      type: "github" as const,
      permissions: ["createPackage" as const],
      claims: { repository: "owner/repo", workflow_ref: { file: "release.yml" } },
    };
    // Pre-flight: the registry reports the OLD (differing) config — so the
    // daemon must DELETE it before POSTing the new one (delete-then-put).
    const oldConfig: TrustedPublisherConfig = {
      id: "old-id",
      type: "github",
      permissions: ["createPackage"],
      claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
    };
    listTrustedPublishersMock.mockResolvedValue({ ok: true, configs: [oldConfig] });

    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "update",
      target: {
        name: "@scope/pkg",
        currentConfig: oldConfig,
      },
      config,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    // delete-then-put: the old id is removed BEFORE the new config is added.
    expect(removeTrustedPublisherMock).toHaveBeenCalledWith(
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/pkg",
      "old-id",
    );
    expect(addTrustedPublisherMock).toHaveBeenCalledOnce();
    expect(addTrustedPublisherMock).toHaveBeenCalledWith(
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/pkg",
      config,
    );
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("success");
  });

  it("Scenario: Given a remove configure-trust event, When confirmed, Then the trusted publisher id is deleted", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "remove",
      target: {
        name: "@scope/pkg",
        currentConfig: {
          id: "remove-id",
          type: "github",
          permissions: ["createPackage"],
          claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
        },
      },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
    expect(removeTrustedPublisherMock).toHaveBeenCalledWith(
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/pkg",
      "remove-id",
    );
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("success");
  });

  it("Scenario: Given the delete-then-put delete fails, When confirmed, Then the new config is NOT added and the event fails", async () => {
    removeTrustedPublisherMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "old config still present",
    });
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const oldConfig: TrustedPublisherConfig = {
      id: "old-id",
      type: "github",
      permissions: ["createPackage"],
      claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
    };
    // Pre-flight reports the differing existing config.
    listTrustedPublishersMock.mockResolvedValue({ ok: true, configs: [oldConfig] });

    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "update",
      target: {
        name: "@scope/pkg",
        currentConfig: oldConfig,
      },
      config: {
        type: "github",
        permissions: ["createPackage"],
        claims: { repository: "owner/repo", workflow_ref: { file: "release.yml" } },
      },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    // delete-then-put: the delete failed, so the add never happened.
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toBe("old config still present");
  });

  it("Scenario: Given configure-trust add fails, When confirmed, Then the registry text is preserved", async () => {
    addTrustedPublisherMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "registry trust offline",
    });
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "add",
      target: { name: "@scope/pkg" },
      config: {
        type: "github",
        permissions: ["createPackage"],
        claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
      },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toBe("registry trust offline");
  });

  it("Scenario: Given grouped configure-trust events, When confirmed, Then each selected package is its own audited action", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const config = {
      type: "github" as const,
      permissions: ["createPackage" as const],
      claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
    };
    const groupId = "trust-group-1";
    // Pre-flight: @scope/a has no existing config (add path); @scope/b has the
    // differing old-b config (delete-then-put path).
    const oldB: TrustedPublisherConfig = {
      id: "old-b",
      type: "github",
      permissions: ["createPackage"],
      claims: { repository: "owner/repo", workflow_ref: { file: "old.yml" } },
    };
    listTrustedPublishersMock.mockImplementation((_auth, name) =>
      name === "@scope/b"
        ? Promise.resolve({ ok: true, configs: [oldB] })
        : Promise.resolve({ ok: true, configs: [] }),
    );
    const first = await scheduler.createProactiveEvent(
      "configure-trust",
      "alice",
      {
        action: "add",
        target: { name: "@scope/a" },
        config,
      },
      groupId,
    );
    const second = await scheduler.createProactiveEvent(
      "configure-trust",
      "alice",
      {
        action: "update",
        target: {
          name: "@scope/b",
          currentConfig: oldB,
        },
        config,
      },
      groupId,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.event.groupId).toBe(groupId);
    expect(second.event.groupId).toBe(groupId);

    await expect(scheduler.confirm(first.event.id)).resolves.toBe(true);
    await expect(scheduler.confirm(second.event.id)).resolves.toBe(true);
    expect(addTrustedPublisherMock).toHaveBeenCalledTimes(2);
    expect(addTrustedPublisherMock).toHaveBeenNthCalledWith(
      1,
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/a",
      config,
    );
    expect(addTrustedPublisherMock).toHaveBeenNthCalledWith(
      2,
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/b",
      config,
    );
    expect(removeTrustedPublisherMock).toHaveBeenCalledWith(
      { registry: "http://registry.test/", token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" },
      "@scope/b",
      "old-b",
    );
    expect(store.getEvent(first.event.id)?.status).toBe("success");
    expect(store.getEvent(second.event.id)?.status).toBe("success");
  });

  it("Scenario: Given oidc for the current package, When mounted from CLI, Then a configure-trust Event is created with the derived GitHub config", async () => {
    const packageDir = path.join(sandbox, "oidc-single");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/oidc-single",
        version: "1.0.0",
        repository: "https://github.com/owner/repo.git",
      }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);
    const exit = vi.fn();
    const log = vi.fn();

    await scheduler.createOidcEvents(
      {
        command: "oidc",
        cwd: packageDir,
        packageNames: [],
        recursive: false,
        file: "publish.yml",
      },
      { log, exit },
    );

    expect(exit).not.toHaveBeenCalled();
    const event = store.getEvents()[0];
    expect(event?.payload?.kind).toBe("configure-trust");
    if (event?.payload?.kind !== "configure-trust") return;
    expect(event.payload.data.action).toBe("add");
    expect(event.payload.data.target).toMatchObject({
      name: "@scope/oidc-single",
      path: packageDir,
    });
    expect(event.payload.data.config).toMatchObject({
      type: "github",
      claims: {
        repository: "owner/repo",
        workflow_ref: { file: "publish.yml" },
      },
    });
    await expect(scheduler.confirm(event.id)).resolves.toBe(true);
    expect(addTrustedPublisherMock).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0, "OIDC events completed.");
  });

  it("Scenario: Given oidc --json, When confirmed, Then the CLI receives one structured result object", async () => {
    const packageDir = path.join(sandbox, "oidc-json");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/oidc-json",
        version: "1.0.0",
        repository: "https://github.com/owner/repo.git",
      }),
      "utf8",
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    const exit = vi.fn();
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createOidcEvents(
      {
        command: "oidc",
        cwd: packageDir,
        packageNames: [],
        recursive: false,
        file: "publish.yml",
        json: true,
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          else stderr.push(data);
        },
        exit,
      },
    );

    expect(created).toHaveLength(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toBe("");
    const event = created?.[0];
    if (!event) return;

    await expect(scheduler.confirm(event.id)).resolves.toBe(true);
    const output: unknown = JSON.parse(stdout.join(""));
    expect(output).toEqual(
      expect.objectContaining({
        ok: true,
        command: "oidc",
        eventIds: [event.id],
      }),
    );
    expect(isRecord(output) ? output.events : undefined).toEqual([
      expect.objectContaining({
        id: event.id,
        status: "success",
        action: "add",
        target: "@scope/oidc-json",
        code: 0,
      }),
    ]);
    expect(stderr.join("")).toBe("");
    expect(exit).toHaveBeenCalledWith(0, "OIDC events completed.");
  });

  it("Scenario: Given recursive oidc with a shared config, When mounted from CLI, Then an EventGroup stores the default once", async () => {
    const workspaceRoot = path.join(sandbox, "oidc-recursive");
    const packageA = path.join(workspaceRoot, "packages/a");
    const packageB = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageA, { recursive: true });
    await fsp.mkdir(packageB, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
    );
    await fsp.writeFile(
      path.join(packageA, "package.json"),
      JSON.stringify({
        name: "@scope/a",
        version: "1.0.0",
        repository: "https://github.com/owner/repo.git",
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageB, "package.json"),
      JSON.stringify({
        name: "@scope/b",
        version: "1.0.0",
        repository: "https://github.com/owner/repo.git",
      }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    await scheduler.createOidcEvents(
      {
        command: "oidc",
        cwd: workspaceRoot,
        packageNames: [],
        recursive: true,
        file: "publish.yml",
      },
      { log: vi.fn(), exit: vi.fn() },
    );

    const events = store.getEvents();
    expect(events).toHaveLength(2);
    const groupId = events[0]?.groupId;
    expect(groupId).toBeTruthy();
    expect(events.every((event) => event.groupId === groupId)).toBe(true);
    expect(store.getGroupTrustDraft(groupId!).defaultConfig).toMatchObject({
      type: "github",
      claims: {
        repository: "owner/repo",
        workflow_ref: { file: "publish.yml" },
      },
    });
    for (const event of events) {
      expect(event.payload?.kind).toBe("configure-trust");
      if (event.payload?.kind === "configure-trust") {
        expect(event.payload.data.config).toBeUndefined();
      }
    }
  });

  it("Scenario: Given an invalid proactive payload, When mounted, Then no executable event is created", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      name: "@scope/pkg",
    });

    expect(created.ok).toBe(false);
    expect(store.getEvents()).toEqual([]);
  });

  it("Scenario: Given a configure-trust event without a draft config, When confirmed, Then no registry action is performed", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("configure-trust", "alice", {
      action: "add",
      target: { name: "@scope/pkg" },
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toContain("config is required");
  });

  it("Scenario: Given an unknown profile, When mounting a proactive action, Then no orphan Event is created", async () => {
    const store = new DaemonStore();
    await store.load();
    const scheduler = new PublishScheduler(store);

    const created = await scheduler.createProactiveEvent("create-placeholder", "ghost", {
      name: "reserved-name",
    });

    expect(created.ok).toBe(false);
    expect(store.getEvents()).toEqual([]);
  });

  it("Scenario: Given a placeholder event, When confirmed, Then it publishes a generated v0.0.0 package", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("create-placeholder", "alice", {
      name: "reserved-name",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(publishPackageMock).toHaveBeenCalledWith({
      registry: "http://registry.test/",
      token: "npm_token",
      totpSecret: "JBSWY3DPEHPK3PXP",
      name: "reserved-name",
      version: "0.0.0",
      tarball: Buffer.from("placeholder tarball"),
      metadata: expect.objectContaining({
        name: "reserved-name",
        version: "0.0.0",
      }),
    });
    expect(store.getEvent(created.event.id)?.status).toBe("success");
  });

  it("Scenario: Given placeholder packing rejects with a non-Error value, When confirmed, Then the source text is preserved", async () => {
    packPackageMock.mockRejectedValueOnce("placeholder pack failed");
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("create-placeholder", "alice", {
      name: "reserved-name",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toBe("placeholder pack failed");
  });

  it("Scenario: Given a write-capable event without credentials, When confirmed, Then it requires credential input", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("create-placeholder", "alice", {
      name: "reserved-name",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("action-required");
    expect(event?.result).toBe("Credentials for alice are missing. Re-apply them in the tray.");
    expect(packPackageMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
  });

  it("Scenario: Given a refresh-token event, When confirmed, Then it requires credential input", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "old-token", totpSecret: "JBSWY3DPEHPK3PXP" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("refresh-token", "alice", {
      username: "alice",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("action-required");
    expect(event?.result).toBe("Token refresh for alice requires credential re-apply.");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
  });

  it("Scenario: Given a refresh-token event without loaded credentials, When confirmed, Then it still requires credential input", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });

    const scheduler = new PublishScheduler(store);
    const created = await scheduler.createProactiveEvent("refresh-token", "alice", {
      username: "alice",
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(scheduler.confirm(created.event.id)).resolves.toBe(true);
    const event = store.getEvent(created.event.id);
    expect(event?.status).toBe("action-required");
    expect(event?.result).toBe("Token refresh for alice requires credential re-apply.");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(addTrustedPublisherMock).not.toHaveBeenCalled();
  });

  it("Scenario: Given a publish with an explicit profile override, When intercepted, Then the pending event stores that override", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    await store.upsertProfile({ username: "work", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    const created = scheduler.intercept(
      {
        command: "publish",
        cwd: "/tmp/project",
        args: ["--dry-run", "--ignore-scripts"],
        profileOverride: "work",
      },
      {
        log: vi.fn(),
        exit: vi.fn(),
      },
    );

    await expect(created).resolves.toMatchObject({
      kind: "publish",
      profile: "work",
      profileOverride: "work",
      status: "pending",
    });

    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.profile).toBe("work");
    expect(pending?.profileOverride).toBe("work");
    expect(pending?.payload?.kind).toBe("publish");
  });

  it("Scenario: Given publish packing rejects with a non-Error value, When confirmed, Then the source text is preserved", async () => {
    const packageDir = path.join(sandbox, "publish-non-error-pack");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    packPackageMock.mockRejectedValueOnce("publish pack failed");
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);
    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toBe("publish pack failed");
    expect(log).toHaveBeenCalledWith("stderr", "publish pack failed\n");
    expect(exit).toHaveBeenCalledWith(1, "publish pack failed");
  });

  it("Scenario: Given publish args with --registry value, When confirmed, Then the command registry overrides the profile registry", async () => {
    const packageDir = path.join(sandbox, "publish-cli-registry-value");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--registry", "http://cli-registry.test/"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://cli-registry.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "pkg",
        version: "1.0.0",
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a directory publish with pnpm on PATH, When confirmed, Then the CLI primary path is used (not the API fallback)", async () => {
    const packageDir = path.join(sandbox, "publish-cli-primary");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    // pnpm present → the CLI primary path runs publishPackageViaCli.
    publishPackageViaCliMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      stdout: "",
      stderr: "",
    });

    await scheduler.intercept(
      { command: "publish", cwd: packageDir, args: ["--access", "public"] },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    if (!pending) throw new Error("no pending event");

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    // The CLI executor received the package cwd + forwarded args + credentials.
    expect(publishPackageViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: packageDir,
        registry: "http://registry.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    );
    // The API fallback was NOT used.
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a recursive-publish event, When confirmed with pnpm, Then publishRecursiveViaCli is invoked", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-confirm");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      '{"name":"root","version":"1.0.0","private":true}',
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"2.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    // intercept with --recursive → enumerates targets via mocked pnpm, creating
    // a recursive-publish event bound to the real CLI client (so exit is wired).
    hasPnpmMock.mockResolvedValue(true);
    listRecursivePackagesMock.mockResolvedValue([
      { name: "root", version: "1.0.0", path: workspaceRoot, private: true },
      { name: "pkg", version: "2.0.0", path: packageDir, private: false },
    ]);
    publishRecursiveViaCliMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      stdout: "",
      stderr: "",
    });

    await scheduler.intercept(
      { command: "publish", cwd: workspaceRoot, args: ["--recursive", "--no-git-checks"] },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("recursive-publish");
    if (pending?.payload?.kind !== "recursive-publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishRecursiveViaCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspaceRoot,
        registry: "http://registry.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    );
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(publishPackageViaCliMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a recursive-publish that fails, When confirmed, Then the full pnpm stderr is persisted in event.result (not just a single line)", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-stderr");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      '{"name":"root","version":"1.0.0","private":true}',
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"@scope/pkg","version":"2.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    hasPnpmMock.mockResolvedValue(true);
    listRecursivePackagesMock.mockResolvedValue([
      { name: "root", version: "1.0.0", path: workspaceRoot, private: true },
      { name: "@scope/pkg", version: "2.0.0", path: packageDir, private: false },
    ]);
    // Simulate a registry failure with a multi-line stderr body.
    const fullStderr = [
      "npm notice Publishing to http://registry.test/",
      "npm error code E404",
      "npm error 404 Not Found - PUT http://registry.test/@scope/pkg - Package not found",
      "npm error A complete log of this run can be found in: /tmp/log",
    ].join("\n");
    publishRecursiveViaCliMock.mockResolvedValueOnce({
      ok: false,
      status: 1,
      error: "404 Not Found",
      stdout: "",
      stderr: fullStderr,
    });

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--no-git-checks", "--access", "public"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    if (pending?.payload?.kind !== "recursive-publish")
      throw new Error("expected recursive-publish event");

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const resolved = store.getEvent(pending.id);
    expect(resolved?.status).toBe("failed");
    // The FULL multi-line stderr is persisted — not just the single extracted line.
    expect(resolved?.result).toBe(fullStderr);
    expect(resolved?.result).toContain("E404");
    expect(resolved?.result).toContain("@scope/pkg");
    expect((resolved?.result?.match(/\n/g) ?? []).length).toBeGreaterThan(0);
    expect(exit).toHaveBeenCalledWith(1, expect.any(String));
  });

  it("Scenario: Given publish args with --registry=value, When confirmed, Then the command registry overrides the profile registry", async () => {
    const packageDir = path.join(sandbox, "publish-cli-registry-equals");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--registry=http://cli-registry.test/"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://cli-registry.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "pkg",
        version: "1.0.0",
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --tag value, When confirmed, Then the command dist-tag reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-tag-value");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--tag", "beta"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(expect.objectContaining({ distTag: "beta" }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --tag=value, When confirmed, Then the command dist-tag reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-tag-equals");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--tag=next"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(expect.objectContaining({ distTag: "next" }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --access value, When confirmed, Then the command access reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-access-value");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"@scope/pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--access", "public"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(expect.objectContaining({ access: "public" }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --access=value, When confirmed, Then the command access reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-access-equals");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"@scope/pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--access=restricted"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({ access: "restricted" }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --otp value, When confirmed, Then the command OTP reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-otp-value");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--otp", "123456"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(expect.objectContaining({ otp: "123456" }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --otp=value, When confirmed, Then the command OTP reaches publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-cli-otp-equals");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--otp=654321"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(expect.objectContaining({ otp: "654321" }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --report-summary, When publish succeeds, Then the pnpm summary artifact is written", async () => {
    const packageDir = path.join(sandbox, "publish-report-summary");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--report-summary"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const summaryText = await fsp.readFile(
      path.join(packageDir, "pnpm-publish-summary.json"),
      "utf8",
    );
    const summary: unknown = JSON.parse(summaryText);
    expect(summary).toEqual({ publishedPackages: [{ name: "pkg", version: "1.0.0" }] });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --json, When publish succeeds, Then stdout is a package JSON projection", async () => {
    const packageDir = path.join(sandbox, "publish-json");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--json"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          else stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const outputText = stdout.join("");
    const output: unknown = JSON.parse(outputText);
    expect(output).toEqual(
      expect.objectContaining({
        id: "pkg@1.0.0",
        name: "pkg",
        version: "1.0.0",
        size: Buffer.from("placeholder tarball").length,
        filename: "pkg-1.0.0.tgz",
      }),
    );
    expect(outputText).not.toContain("packing");
    expect(outputText).not.toContain("[publish]");
    expect(stderr).toEqual([]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --json and a summarized tarball, When publish succeeds, Then stdout includes native file-list facts", async () => {
    const packageDir = path.join(sandbox, "publish-json-file-list");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    summarizePackageTarballMock.mockResolvedValueOnce({
      unpackedSize: 49,
      files: [
        { path: "package.json", size: 34, mode: 420 },
        { path: "index.js", size: 15, mode: 420 },
      ],
      entryCount: 2,
      bundled: [],
    });
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--json"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const output: unknown = JSON.parse(stdout.join(""));
    expect(output).toEqual(
      expect.objectContaining({
        unpackedSize: 49,
        files: [
          { path: "package.json", size: 34, mode: 420 },
          { path: "index.js", size: 15, mode: 420 },
        ],
        entryCount: 2,
        bundled: [],
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given publish args with --ignore-scripts, When confirmed, Then packing skips lifecycle scripts", async () => {
    const packageDir = path.join(sandbox, "publish-ignore-scripts");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--ignore-scripts"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledWith(packageDir, { ignoreScripts: true });
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given package publishConfig defaults, When publish is confirmed, Then package defaults reach publishPackage", async () => {
    const packageDir = path.join(sandbox, "publish-package-config-defaults");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/pkg",
        version: "1.0.0",
        publishConfig: {
          registry: "http://package-registry.test/",
          tag: "beta",
          access: "public",
        },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: [],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://package-registry.test/",
        distTag: "beta",
        access: "public",
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given CLI publish args and package publishConfig, When confirmed, Then CLI args override package defaults", async () => {
    const packageDir = path.join(sandbox, "publish-package-config-cli-precedence");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/pkg",
        version: "1.0.0",
        publishConfig: {
          registry: "http://package-registry.test/",
          tag: "beta",
          access: "restricted",
        },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--registry", "http://cli-registry.test/", "--tag=next", "--access", "public"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://cli-registry.test/",
        distTag: "next",
        access: "public",
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a publish directory argument, When confirmed, Then the requested package directory is the publish source", async () => {
    const workspaceRoot = path.join(sandbox, "publish-directory-argument");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--registry", "http://cli-registry.test/", "packages/pkg"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    expect(pending.payload.data.source).toEqual({ kind: "directory", path: packageDir });
    expect(pending.payload.data.target).toMatchObject({
      name: "requested-pkg",
      version: "1.2.3",
      path: packageDir,
    });

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://cli-registry.test/",
        name: "requested-pkg",
        version: "1.2.3",
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a publish tarball argument, When confirmed, Then the tarball is the publish source", async () => {
    const workspaceRoot = path.join(sandbox, "publish-tarball-argument");
    const tarballPath = path.join(workspaceRoot, "requested-pkg-1.2.3.tgz");
    await fsp.mkdir(workspaceRoot, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9" }),
      "utf8",
    );
    await fsp.writeFile(tarballPath, "packed bytes", "utf8");
    await fsp.writeFile(
      `${tarballPath}.package.json`,
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--registry", "http://cli-registry.test/", "./requested-pkg-1.2.3.tgz"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    expect(pending.payload.data.source).toEqual({ kind: "tarball", path: tarballPath });
    expect(pending.payload.data.target).toMatchObject({
      name: "requested-pkg",
      version: "1.2.3",
      path: tarballPath,
    });

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).not.toHaveBeenCalled();
    expect(readPackageTarballMock).toHaveBeenCalledWith(tarballPath);
    expect(publishPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: "http://cli-registry.test/",
        name: "requested-pkg",
        version: "1.2.3",
        tarball: Buffer.from("packed bytes"),
      }),
    );
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given an unknown publish option, When intercepted, Then it is forwarded verbatim (drop-in parity, no pre-rejection)", async () => {
    const packageDir = path.join(sandbox, "publish-unknown-option");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "unknown-option-pkg", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    // Chapter 7.1.2 — pnpm-pub no longer pre-rejects unknown flags; they are
    // forwarded to `pnpm publish`, which reports any genuine errors. The intent
    // is accepted and a pending event is created.
    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--no-git-checks", "--made-up-flag"],
      },
      { log, exit },
    );

    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    // The unknown flag must be preserved verbatim in the forwarded argv.
    expect(pending.payload.data.args).toContain("--made-up-flag");
    // No early failure: stderr/exit are not invoked at intercept time.
    expect(log).not.toHaveBeenCalledWith("stderr", expect.stringContaining("Unknown option"));
    expect(exit).not.toHaveBeenCalledWith(1, expect.stringContaining("Unknown option"));
  });

  it("Scenario: Given a config namespace publish option, When dry-run is confirmed, Then it warns and preserves source resolution", async () => {
    const packageDir = path.join(sandbox, "publish-config-option");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "config-option-pkg", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--no-git-checks", "--config.foo=bar"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain('npm warn Unknown cli config "--config.foo"');
    expect(stdout.join("")).toBe("+ config-option-pkg@1.0.0\n");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a config namespace token before a directory, When intercepted, Then the directory remains the publish source", async () => {
    const packageDir = path.join(sandbox, "publish-config-option-source");
    const sourceDir = path.join(packageDir, "pkg");
    await fsp.mkdir(sourceDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "config-root-pkg", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ name: "config-source-pkg", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--no-git-checks", "--config.foo", "pkg"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain('npm warn Unknown cli config "--config.foo"');
    expect(stdout.join("")).toBe("+ config-source-pkg@1.0.0\n");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive publish args without pnpm, When intercepted, Then it is refused before any event is created", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-no-pnpm");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    // pnpm absent (the beforeEach default) → recursive publish is refused.
    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--filter", "./packages/*"],
      },
      { log, exit },
    );

    // No pending event is created; the CLI is exited with an error.
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeUndefined();
    expect(packPackageMock).not.toHaveBeenCalled();
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(publishPackageViaCliMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "stderr",
      "Recursive publish requires pnpm on PATH; no fallback is available.\n",
    );
    expect(exit).toHaveBeenCalledWith(
      1,
      "Recursive publish requires pnpm on PATH; no fallback is available.",
    );
  });

  it("Scenario: Given recursive publish args with pnpm, When intercepted, Then a recursive-publish event is created with enumerated targets", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-with-pnpm");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    // pnpm present → enumerate two packages, one private (filtered out).
    hasPnpmMock.mockResolvedValue(true);
    listRecursivePackagesMock.mockResolvedValue([
      { name: "workspace-root", version: "9.9.9", path: workspaceRoot, private: true },
      { name: "requested-pkg", version: "1.2.3", path: packageDir, private: false },
    ]);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--no-git-checks"],
      },
      { log, exit },
    );

    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("recursive-publish");
    if (pending?.payload?.kind !== "recursive-publish") return;
    // The private root package is filtered out; only the public package remains.
    expect(pending.payload.data.targets).toHaveLength(1);
    expect(pending.payload.data.targets[0]?.name).toBe("requested-pkg");
  });

  it("Scenario: Given recursive dry-run publish args, When confirmed, Then workspace packages are packed without registry writes", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    const privateDir = path.join(workspaceRoot, "packages/private");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(privateDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(privateDir, "package.json"),
      JSON.stringify({ name: "private-pkg", version: "0.0.1", private: true }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 2 packages packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).toHaveBeenCalledWith(workspaceRoot);
    expect(packPackageMock).not.toHaveBeenCalledWith(privateDir);
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    const outputText = stdout.join("");
    expect(outputText).toBe("+ requested-pkg@1.2.3\n+ workspace-root@9.9.9\n");
    expect(outputText).not.toContain("packing");
    expect(outputText).not.toContain("Recursive dry run complete");
    expect(stderr.join("")).toBe("");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a positional directory, When confirmed, Then the current workspace remains the source", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-positional-source");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    const positionalDir = path.join(workspaceRoot, "other");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(positionalDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "recursive-positional-pkg", version: "1.2.3" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(positionalDir, "package.json"),
      JSON.stringify({ name: "recursive-positional-other", version: "9.9.9" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--no-git-checks", "other"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(positionalDir);
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(stdout.join("")).toBe("+ recursive-positional-pkg@1.2.3\n");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with --report-summary, When confirmed, Then the workspace summary artifact is written", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-report-summary");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "summary-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "summary-b", version: "2.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--report-summary",
          "--filter",
          "summary-*",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const summaryText = await fsp.readFile(
      path.join(workspaceRoot, "pnpm-publish-summary.json"),
      "utf8",
    );
    const summary: unknown = JSON.parse(summaryText);
    expect(summary).toEqual({
      publishedPackages: [
        { name: "summary-a", version: "1.0.0" },
        { name: "summary-b", version: "2.0.0" },
      ],
    });
    await expect(fsp.access(path.join(packageADir, "pnpm-publish-summary.json"))).rejects.toThrow();
    await expect(fsp.access(path.join(packageBDir, "pnpm-publish-summary.json"))).rejects.toThrow();
    expect(stdout.join("")).toBe("+ summary-a@1.0.0\n+ summary-b@2.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with tarball facts, When confirmed, Then stderr emits npm notice details", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run-notices");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "notice-pkg",
        version: "1.2.3",
        publishConfig: {
          registry: "http://package-registry.test/",
          tag: "beta",
          access: "public",
        },
      }),
      "utf8",
    );
    summarizePackageTarballMock.mockResolvedValueOnce({
      files: [
        { path: "README.md", size: 4, mode: 0o644 },
        { path: "package.json", size: 103, mode: 0o644 },
      ],
      unpackedSize: 107,
      entryCount: 2,
      bundled: [],
    });
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const outputText = stdout.join("");
    const noticeText = stderr.join("");
    expect(outputText).toBe("+ notice-pkg@1.2.3\n");
    expect(noticeText).toContain("npm notice Tarball Contents\n");
    expect(noticeText).toContain("npm notice 4B README.md\n");
    expect(noticeText).toContain("npm notice name: notice-pkg\n");
    expect(noticeText).toContain("npm notice version: 1.2.3\n");
    expect(noticeText).toContain("npm notice filename: notice-pkg-1.2.3.tgz\n");
    expect(noticeText).toContain("npm notice package size: 19 B\n");
    expect(noticeText).toContain("npm notice unpacked size: 107 B\n");
    expect(noticeText).toContain("npm notice total files: 2\n");
    expect(noticeText).toContain(
      "npm notice Publishing to http://package-registry.test/ with tag beta and public access (dry-run)\n",
    );
    expect(summarizePackageTarballMock).toHaveBeenCalledWith(expect.any(Buffer));
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with bundled tarball facts, When confirmed, Then stderr emits bundled dependency notices", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run-bundled-notices");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({
        name: "bundle-notice-pkg",
        version: "1.2.3",
      }),
      "utf8",
    );
    summarizePackageTarballMock.mockResolvedValueOnce({
      files: [{ path: "package.json", size: 126, mode: 0o644 }],
      unpackedSize: 9_900,
      entryCount: 11,
      bundled: ["left-pad"],
    });
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://profile-registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const noticeText = stderr.join("");
    expect(stdout.join("")).toBe("+ bundle-notice-pkg@1.2.3\n");
    expect(noticeText).toContain("npm notice Tarball Contents\n");
    expect(noticeText).toContain("npm notice 126B package.json\n");
    expect(noticeText).not.toContain("npm notice node_modules/left-pad");
    expect(noticeText).toContain("npm notice Bundled Dependencies\n");
    expect(noticeText).toContain("npm notice left-pad\n");
    expect(noticeText).toContain("npm notice bundled deps: 1\n");
    expect(noticeText).toContain("npm notice bundled files: 0\n");
    expect(noticeText).toContain("npm notice own files: 11\n");
    expect(noticeText).toContain("npm notice total files: 11\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a path filter, When confirmed, Then only matching packages are packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run-filter");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "requested-pkg", version: "1.2.3" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "other-pkg", version: "2.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "./packages/pkg", "--no-git-checks"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 1 package packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish from a package with current-project filter, When confirmed, Then only the current package is packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-current-project-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "dot-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "dot-b", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageADir,
        args: ["--recursive", "--dry-run", "--filter", ".", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(stdout.join("")).toBe("+ dot-a@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a brace directory filter, When confirmed, Then matching package directories are packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-brace-directory-filter");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "brace-pkg", version: "1.2.3" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "other-pkg", version: "2.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "{packages/pkg}", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 1 package packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(stdout.join("")).toBe("+ brace-pkg@1.2.3\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a combined package and directory filter, When confirmed, Then only the intersection is packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-combined-filter");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    const siblingDir = path.join(workspaceRoot, "packages/other");
    const outsideDir = path.join(workspaceRoot, "other/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(siblingDir, { recursive: true });
    await fsp.mkdir(outsideDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n  - other/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "combo-pkg", version: "1.2.3" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(siblingDir, "package.json"),
      JSON.stringify({ name: "sibling-pkg", version: "2.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(outsideDir, "package.json"),
      JSON.stringify({ name: "combo-pkg", version: "3.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "combo-pkg{packages/*}", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 1 package packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(siblingDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(outsideDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(stdout.join("")).toBe("+ combo-pkg@1.2.3\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a combined package directory graph filter, When confirmed, Then dependencies are packed before the intersected package", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-combined-graph-filter");
    const depDir = path.join(workspaceRoot, "packages/dep");
    const appDir = path.join(workspaceRoot, "packages/app");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(depDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(depDir, "package.json"),
      JSON.stringify({ name: "combo-dep", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "combo-app",
        version: "1.0.0",
        dependencies: { "combo-dep": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "combo-other", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter",
          "combo-app{packages/app}...",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, depDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(stdout.join("")).toBe("+ combo-dep@1.0.0\n+ combo-app@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a changed-since filter, When confirmed, Then packages with changed files are packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-changed-since-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "changed-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 1;\n", "utf8");
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "changed-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 1;\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot });
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 2;\n", "utf8");
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "[HEAD]", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(stdout.join("")).toBe("+ changed-a@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with changed file ignore patterns, When confirmed, Then ignored file-only packages are not packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-changed-file-ignore-pattern");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "ignore-changed-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageADir, "README.md"), "old\n", "utf8");
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "ignore-changed-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 1;\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot });
    await fsp.writeFile(path.join(packageADir, "README.md"), "new\n", "utf8");
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 2;\n", "utf8");
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter",
          "[HEAD]",
          "--changed-files-ignore-pattern",
          "**/README.md",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageBDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageADir);
    expect(stdout.join("")).toBe("+ ignore-changed-b@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a package changed-since filter, When confirmed, Then changed package identity is required", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-package-changed-since-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "changed-suffix-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 1;\n", "utf8");
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "changed-suffix-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 1;\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot });
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 2;\n", "utf8");
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "changed-suffix-a[HEAD]", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(stdout.join("")).toBe("+ changed-suffix-a@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a directory changed-since filter, When confirmed, Then changed package path is required", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-directory-changed-since-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "changed-dir-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 1;\n", "utf8");
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "changed-dir-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 1;\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot });
    await fsp.writeFile(path.join(packageADir, "index.js"), "module.exports = 2;\n", "utf8");
    await fsp.writeFile(path.join(packageBDir, "index.js"), "module.exports = 2;\n", "utf8");
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "{packages/a}[HEAD]", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(stdout.join("")).toBe("+ changed-dir-a@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a changed-since dependent graph filter, When confirmed, Then dependents are packed after changed packages", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-changed-since-dependent-filter");
    const depDir = path.join(workspaceRoot, "packages/dep");
    const appDir = path.join(workspaceRoot, "packages/app");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(depDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(depDir, "package.json"),
      JSON.stringify({ name: "changed-dep", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(depDir, "index.js"), "module.exports = 1;\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "changed-app",
        version: "1.0.0",
        dependencies: { "changed-dep": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(path.join(appDir, "index.js"), "module.exports = 1;\n", "utf8");
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "changed-other", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(path.join(otherDir, "index.js"), "module.exports = 1;\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: workspaceRoot,
    });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "."], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: workspaceRoot });
    await fsp.writeFile(path.join(depDir, "index.js"), "module.exports = 2;\n", "utf8");
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "...[HEAD]", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, depDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(stdout.join("")).toBe("+ changed-dep@1.0.0\n+ changed-app@1.0.0\n");
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with no matching filters, When confirmed, Then it exits as a native no-op", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run-no-match");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "available-pkg", version: "1.2.3" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--report-summary",
          "--filter",
          "missing-pkg",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    const msg = `No projects matched the filters in "${workspaceRoot}"`;
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(msg);
    expect(stdout.join("")).toBe(`${msg}\n`);
    expect(stderr.join("")).toBe("");
    expect(packPackageMock).not.toHaveBeenCalled();
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    await expect(
      fsp.access(path.join(workspaceRoot, "pnpm-publish-summary.json")),
    ).rejects.toThrow();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with unsupported bare graph filters, When confirmed, Then it fails before packing", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-unsupported-bare-graph-filter");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "unsupported-graph-pkg", version: "1.0.0" }),
      "utf8",
    );

    for (const option of ["--filter", "--filter-prod"]) {
      for (const filter of ["...", "^...", "...^", "......", "...^..."]) {
        packPackageMock.mockClear();
        readPackageTarballMock.mockClear();
        publishPackageMock.mockClear();
        const exit = vi.fn();
        const stdout: string[] = [];
        const stderr: string[] = [];
        const store = new DaemonStore();
        await store.load();
        await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
        const scheduler = new PublishScheduler(store);

        await scheduler.intercept(
          {
            command: "publish",
            cwd: workspaceRoot,
            args: ["--recursive", "--dry-run", option, filter, "--no-git-checks"],
          },
          {
            log: (stream, data) => {
              if (stream === "stdout") stdout.push(data);
              if (stream === "stderr") stderr.push(data);
            },
            exit,
          },
        );
        const pending = store.getEvents().find((event) => event.status === "pending");
        expect(pending?.payload?.kind).toBe("publish");
        if (pending?.payload?.kind !== "publish") return;

        await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

        const expectedProdFlag = option === "--filter-prod" ? "true" : "false";
        const event = store.getEvent(pending.id);
        expect(event?.status).toBe("failed");
        expect(event?.result).toContain("Unsupported package selector");
        expect(event?.result).toContain(`"followProdDepsOnly":${expectedProdFlag}`);
        expect(stdout.join("")).toContain("Unsupported package selector");
        expect(stdout.join("")).toContain(`"followProdDepsOnly":${expectedProdFlag}`);
        expect(stderr.join("")).toBe("");
        expect(packPackageMock).not.toHaveBeenCalled();
        expect(readPackageTarballMock).not.toHaveBeenCalled();
        expect(publishPackageMock).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(
          1,
          expect.stringContaining("Unsupported package selector"),
        );
      }
    }
  });

  it("Scenario: Given recursive dry-run publish with fail-if-no-match, When no filters match, Then it exits as a native failure", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dry-run-fail-if-no-match");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "native-no-match-pkg", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter",
          "missing-pkg",
          "--fail-if-no-match",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    const msg = `No projects matched the filters in "${workspaceRoot}"`;
    expect(event?.status).toBe("failed");
    expect(event?.result).toBe(msg);
    expect(stdout.join("")).toBe(`${msg}\n`);
    expect(stderr.join("")).toBe("");
    expect(packPackageMock).not.toHaveBeenCalled();
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1, msg);
  });

  it("Scenario: Given recursive dry-run publish with a dependency graph filter, When confirmed, Then dependencies are packed before the selected package", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dependency-graph-filter");
    const leafDir = path.join(workspaceRoot, "packages/leaf");
    const midDir = path.join(workspaceRoot, "packages/mid");
    const appDir = path.join(workspaceRoot, "packages/app");
    await fsp.mkdir(leafDir, { recursive: true });
    await fsp.mkdir(midDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(leafDir, "package.json"),
      JSON.stringify({ name: "graph-leaf", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(midDir, "package.json"),
      JSON.stringify({
        name: "graph-mid",
        version: "1.0.0",
        dependencies: { "graph-leaf": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "graph-app",
        version: "1.0.0",
        dependencies: { "graph-mid": "workspace:*" },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "graph-app...", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(stdout.join("")).toBe("+ graph-leaf@1.0.0\n+ graph-mid@1.0.0\n+ graph-app@1.0.0\n");
    expect(packPackageMock).toHaveBeenCalledTimes(3);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, leafDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, midDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(3, appDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a combined graph filter, When confirmed, Then dependencies and dependents are packed around the selected package", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-combined-graph-both-directions");
    const leafDir = path.join(workspaceRoot, "packages/leaf");
    const midDir = path.join(workspaceRoot, "packages/mid");
    const appDir = path.join(workspaceRoot, "packages/app");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(leafDir, { recursive: true });
    await fsp.mkdir(midDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(leafDir, "package.json"),
      JSON.stringify({ name: "both-leaf", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(midDir, "package.json"),
      JSON.stringify({
        name: "both-mid",
        version: "1.0.0",
        dependencies: { "both-leaf": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "both-app",
        version: "1.0.0",
        dependencies: { "both-mid": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "both-other", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "...both-mid...", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(stdout.join("")).toBe("+ both-leaf@1.0.0\n+ both-mid@1.0.0\n+ both-app@1.0.0\n");
    expect(packPackageMock).toHaveBeenCalledTimes(3);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, leafDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, midDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(3, appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with combined graph caret filters, When confirmed, Then native seed matching is preserved", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-combined-graph-caret-filters");
    const leafDir = path.join(workspaceRoot, "packages/leaf");
    const midDir = path.join(workspaceRoot, "packages/mid");
    const appDir = path.join(workspaceRoot, "packages/app");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(leafDir, { recursive: true });
    await fsp.mkdir(midDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(leafDir, "package.json"),
      JSON.stringify({ name: "caret-leaf", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(midDir, "package.json"),
      JSON.stringify({
        name: "caret-mid",
        version: "1.0.0",
        dependencies: { "caret-leaf": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "caret-app",
        version: "1.0.0",
        dependencies: { "caret-mid": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "caret-other", version: "1.0.0" }),
      "utf8",
    );

    for (const filter of ["...^caret-mid...", "...caret-mid^...", "...^caret-mid^..."]) {
      packPackageMock.mockClear();
      publishPackageMock.mockClear();
      const exit = vi.fn();
      const stdout: string[] = [];
      const store = new DaemonStore();
      await store.load();
      await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
      const scheduler = new PublishScheduler(store);

      await scheduler.intercept(
        {
          command: "publish",
          cwd: workspaceRoot,
          args: ["--recursive", "--dry-run", "--filter", filter, "--no-git-checks"],
        },
        {
          log: (stream, data) => {
            if (stream === "stdout") stdout.push(data);
          },
          exit,
        },
      );
      const pending = store.getEvents().find((event) => event.status === "pending");
      expect(pending?.payload?.kind).toBe("publish");
      if (pending?.payload?.kind !== "publish") return;

      await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

      expect(stdout.join("")).toBe("+ caret-leaf@1.0.0\n+ caret-mid@1.0.0\n+ caret-app@1.0.0\n");
      expect(packPackageMock).toHaveBeenCalledTimes(3);
      expect(packPackageMock).toHaveBeenNthCalledWith(1, leafDir);
      expect(packPackageMock).toHaveBeenNthCalledWith(2, midDir);
      expect(packPackageMock).toHaveBeenNthCalledWith(3, appDir);
      expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
      expect(publishPackageMock).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(0);
    }
  });

  it("Scenario: Given recursive dry-run publish from a package with current-project graph filters, When confirmed, Then only the current package is packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-current-project-graph-filter");
    const leafDir = path.join(workspaceRoot, "packages/leaf");
    const appDir = path.join(workspaceRoot, "packages/app");
    const consumerDir = path.join(workspaceRoot, "packages/consumer");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(leafDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.mkdir(consumerDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(leafDir, "package.json"),
      JSON.stringify({ name: "dot-graph-leaf", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "dot-graph-app",
        version: "1.0.0",
        dependencies: { "dot-graph-leaf": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify({
        name: "dot-graph-consumer",
        version: "1.0.0",
        dependencies: { "dot-graph-app": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "dot-graph-other", version: "1.0.0" }),
      "utf8",
    );

    for (const filter of ["./...", "....", ".^...", "./^...", "...^.", "...^./"]) {
      packPackageMock.mockClear();
      publishPackageMock.mockClear();
      const exit = vi.fn();
      const stdout: string[] = [];
      const store = new DaemonStore();
      await store.load();
      await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
      const scheduler = new PublishScheduler(store);

      await scheduler.intercept(
        {
          command: "publish",
          cwd: appDir,
          args: ["--recursive", "--dry-run", "--filter", filter, "--no-git-checks"],
        },
        {
          log: (stream, data) => {
            if (stream === "stdout") stdout.push(data);
          },
          exit,
        },
      );
      const pending = store.getEvents().find((event) => event.status === "pending");
      expect(pending?.payload?.kind).toBe("publish");
      if (pending?.payload?.kind !== "publish") return;

      await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

      expect(stdout.join("")).toBe("+ dot-graph-app@1.0.0\n");
      expect(packPackageMock).toHaveBeenCalledTimes(1);
      expect(packPackageMock).toHaveBeenCalledWith(appDir);
      expect(packPackageMock).not.toHaveBeenCalledWith(leafDir);
      expect(packPackageMock).not.toHaveBeenCalledWith(consumerDir);
      expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
      expect(publishPackageMock).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(0);
    }
  });

  it("Scenario: Given recursive dry-run publish with a production dependency graph filter, When confirmed, Then dev dependencies are not packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-filter-prod-dependencies");
    const prodDir = path.join(workspaceRoot, "packages/prod");
    const optionalDir = path.join(workspaceRoot, "packages/optional");
    const peerDir = path.join(workspaceRoot, "packages/peer");
    const devDir = path.join(workspaceRoot, "packages/dev");
    const appDir = path.join(workspaceRoot, "packages/app");
    await fsp.mkdir(prodDir, { recursive: true });
    await fsp.mkdir(optionalDir, { recursive: true });
    await fsp.mkdir(peerDir, { recursive: true });
    await fsp.mkdir(devDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(prodDir, "package.json"),
      JSON.stringify({ name: "filter-prod-prod", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(optionalDir, "package.json"),
      JSON.stringify({ name: "filter-prod-optional", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(peerDir, "package.json"),
      JSON.stringify({ name: "filter-prod-peer", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(devDir, "package.json"),
      JSON.stringify({ name: "filter-prod-dev", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "filter-prod-app",
        version: "1.0.0",
        dependencies: { "filter-prod-prod": "workspace:*" },
        optionalDependencies: { "filter-prod-optional": "workspace:*" },
        peerDependencies: { "filter-prod-peer": "workspace:*" },
        devDependencies: { "filter-prod-dev": "workspace:*" },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter-prod",
          "filter-prod-app...",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(stdout.join("")).toBe(
      "+ filter-prod-prod@1.0.0\n+ filter-prod-optional@1.0.0\n+ filter-prod-peer@1.0.0\n+ filter-prod-app@1.0.0\n",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(4);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, prodDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, optionalDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(3, peerDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(4, appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(devDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a production dependent graph filter, When confirmed, Then dev-only dependents are not packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-filter-prod-dependents");
    const prodDir = path.join(workspaceRoot, "packages/prod");
    const devDir = path.join(workspaceRoot, "packages/dev");
    const appDir = path.join(workspaceRoot, "packages/app");
    await fsp.mkdir(prodDir, { recursive: true });
    await fsp.mkdir(devDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(prodDir, "package.json"),
      JSON.stringify({ name: "filter-prod-prod", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(devDir, "package.json"),
      JSON.stringify({ name: "filter-prod-dev", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "filter-prod-app",
        version: "1.0.0",
        dependencies: { "filter-prod-prod": "workspace:*" },
        devDependencies: { "filter-prod-dev": "workspace:*" },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter-prod",
          "...filter-prod-dev",
          "--no-git-checks",
        ],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(stdout.join("")).toBe("+ filter-prod-dev@1.0.0\n");
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(devDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(prodDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a dependent graph filter, When confirmed, Then dependents are packed after the selected package", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-dependent-graph-filter");
    const leafDir = path.join(workspaceRoot, "packages/leaf");
    const midDir = path.join(workspaceRoot, "packages/mid");
    const appDir = path.join(workspaceRoot, "packages/app");
    await fsp.mkdir(leafDir, { recursive: true });
    await fsp.mkdir(midDir, { recursive: true });
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(leafDir, "package.json"),
      JSON.stringify({ name: "graph-leaf", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(midDir, "package.json"),
      JSON.stringify({
        name: "graph-mid",
        version: "1.0.0",
        dependencies: { "graph-leaf": "workspace:*" },
      }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "package.json"),
      JSON.stringify({
        name: "graph-app",
        version: "1.0.0",
        devDependencies: { "graph-mid": "workspace:*" },
      }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "...^graph-leaf", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(stdout.join("")).toBe("+ graph-mid@1.0.0\n+ graph-app@1.0.0\n");
    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenNthCalledWith(1, midDir);
    expect(packPackageMock).toHaveBeenNthCalledWith(2, appDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(leafDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a package-name glob filter, When confirmed, Then matching package names are packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-name-glob-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    const otherDir = path.join(workspaceRoot, "packages/other");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "native-recursive-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "native-recursive-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "other-pkg", version: "2.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "native-recursive-*", "--no-git-checks"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 2 packages packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).toHaveBeenCalledWith(packageBDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with a scoped package glob filter, When confirmed, Then matching scoped names are packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-scoped-glob-filter");
    const packageDir = path.join(workspaceRoot, "packages/scope-a");
    const otherDir = path.join(workspaceRoot, "packages/other-b");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.mkdir(otherDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "@scope/a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(otherDir, "package.json"),
      JSON.stringify({ name: "@other/b", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "@scope/*", "--no-git-checks"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 1 package packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(otherDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with only a negated filter, When confirmed, Then excluded packages are not packed", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-negated-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    const packageCDir = path.join(workspaceRoot, "packages/c");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.mkdir(packageCDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "native-neg-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "native-neg-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageCDir, "package.json"),
      JSON.stringify({ name: "other-c", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--filter", "!native-neg-b", "--no-git-checks"],
      },
      { log: () => {}, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 2 packages packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).toHaveBeenCalledWith(packageCDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with positive and negated filters, When confirmed, Then negation subtracts from positive matches", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-positive-negated-filter");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    const packageCDir = path.join(workspaceRoot, "packages/c");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.mkdir(packageCDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "native-neg-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "native-neg-b", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageCDir, "package.json"),
      JSON.stringify({ name: "other-c", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: [
          "--recursive",
          "--dry-run",
          "--filter",
          "native-neg-*",
          "--filter",
          "!native-neg-b",
          "--no-git-checks",
        ],
      },
      { log: () => {}, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 1 package packed; no registry write performed.",
    );
    expect(packPackageMock).toHaveBeenCalledTimes(1);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageBDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(packageCDir);
    expect(packPackageMock).not.toHaveBeenCalledWith(workspaceRoot);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given recursive dry-run publish with --json, When confirmed, Then stdout uses native success lines", async () => {
    const workspaceRoot = path.join(sandbox, "publish-recursive-json-lines");
    const packageADir = path.join(workspaceRoot, "packages/a");
    const packageBDir = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(packageADir, { recursive: true });
    await fsp.mkdir(packageBDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "workspace-root", version: "9.9.9", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageADir, "package.json"),
      JSON.stringify({ name: "native-json-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageBDir, "package.json"),
      JSON.stringify({ name: "native-json-b", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["--recursive", "--dry-run", "--json", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    const outputText = stdout.join("");
    expect(event?.status).toBe("success");
    expect(event?.result).toBe(
      "Recursive dry run complete; 2 packages packed; no registry write performed.",
    );
    expect(outputText).toBe("+ native-json-a@1.0.0\n+ native-json-b@1.0.0\n");
    expect(outputText).not.toContain("[");
    expect(outputText).not.toContain("Recursive dry run complete");
    expect(outputText).not.toContain("packing");
    expect(stderr.join("")).toBe("");
    expect(packPackageMock).toHaveBeenCalledTimes(2);
    expect(packPackageMock).toHaveBeenCalledWith(packageADir);
    expect(packPackageMock).toHaveBeenCalledWith(packageBDir);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a dirty git worktree publish, When confirmed, Then no packing or registry write is performed", async () => {
    const packageDir = path.join(sandbox, "dirty-git-publish");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    await fsp.writeFile(path.join(packageDir, "README.md"), "dirty\n", "utf8");
    await execFileAsync("git", ["init", "-q"], { cwd: packageDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: packageDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: packageDir });
    await execFileAsync("git", ["add", "package.json"], { cwd: packageDir });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: packageDir });
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    store.setCredentials("alice", { token: "npm_token", totpSecret: "JBSWY3DPEHPK3PXP" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(event?.status).toBe("failed");
    expect(event?.result).toContain("Unclean working tree");
    expect(packPackageMock).not.toHaveBeenCalled();
    expect(readPackageTarballMock).not.toHaveBeenCalled();
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("stderr", expect.stringContaining("Unclean working tree"));
    expect(exit).toHaveBeenCalledWith(1, expect.stringContaining("Unclean working tree"));
  });

  it("Scenario: Given a dry-run publish, When confirmed, Then it packs without credentials or registry writes", async () => {
    const packageDir = path.join(sandbox, "dry-run-publish");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];
    summarizePackageTarballMock.mockResolvedValueOnce({
      files: [
        { path: "README.md", size: 4, mode: 0o644 },
        { path: "package.json", size: 103, mode: 0o644 },
      ],
      unpackedSize: 107,
      entryCount: 2,
      bundled: [],
    });

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--report-summary", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const event = store.getEvent(pending.id);
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(event?.status).toBe("success");
    expect(event?.result).toBe("Dry run complete; no registry write performed.");
    await expect(fsp.access(path.join(packageDir, "pnpm-publish-summary.json"))).rejects.toThrow();
    expect(stdout.join("")).toBe("+ pkg@1.0.0\n");
    const noticeText = stderr.join("");
    expect(noticeText).toContain("npm notice Tarball Contents\n");
    expect(noticeText).toContain("npm notice 4B README.md\n");
    expect(noticeText).toContain("npm notice name: pkg\n");
    expect(noticeText).toContain("npm notice version: 1.0.0\n");
    expect(noticeText).toContain(
      "npm notice Publishing to http://registry.test/ with tag latest and default access (dry-run)\n",
    );
    expect(summarizePackageTarballMock).toHaveBeenCalledWith(Buffer.from("placeholder tarball"));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a dry-run publish with --json, When confirmed, Then stdout is parseable package JSON", async () => {
    const packageDir = path.join(sandbox, "dry-run-json-publish");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--json", "--no-git-checks"],
      },
      {
        log: (stream, data) => {
          if (stream === "stdout") stdout.push(data);
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    const outputText = stdout.join("");
    const output: unknown = JSON.parse(outputText);
    expect(output).toEqual(
      expect.objectContaining({
        id: "pkg@1.0.0",
        name: "pkg",
        version: "1.0.0",
        size: expect.any(Number),
        filename: "pkg-1.0.0.tgz",
      }),
    );
    expect(isRecord(output) ? output.size : undefined).toEqual(expect.any(Number));
    expect(Number(isRecord(output) ? output.size : 0)).toBeGreaterThan(0);
    expect(outputText).not.toContain("Dry run complete");
    expect(outputText).not.toContain("packing");
    expect(stderr.join("")).toBe(
      "npm notice Publishing to http://registry.test/ with tag latest and default access (dry-run)\n",
    );
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given a dry-run publish with --ignore-scripts, When confirmed, Then packing still skips lifecycle scripts", async () => {
    const packageDir = path.join(sandbox, "dry-run-ignore-scripts");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );
    const exit = vi.fn();
    const log = vi.fn();

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run", "--ignore-scripts"],
      },
      { log, exit },
    );
    const pending = store.getEvents().find((event) => event.status === "pending");
    expect(pending).toBeTruthy();
    if (!pending) return;

    await expect(scheduler.confirm(pending.id)).resolves.toBe(true);

    expect(packPackageMock).toHaveBeenCalledWith(packageDir, { ignoreScripts: true });
    expect(publishPackageMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("Scenario: Given malformed package metadata, When publish is intercepted, Then the event uses neutral target facts", async () => {
    const packageDir = path.join(sandbox, "malformed-package");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: 42, version: null, description: ["not", "text"] }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: [],
      },
      {
        log: vi.fn(),
        exit: vi.fn(),
      },
    );

    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    expect(pending.payload.data.target).toEqual({
      name: "(unknown)",
      version: "0.0.0",
      path: packageDir,
    });
  });

  it("Scenario: Given a CLI publish cwd inside a workspace, When intercepted, Then the daemon records the workspace root", async () => {
    const workspaceRoot = path.join(sandbox, "monorepo");
    const packageDir = path.join(workspaceRoot, "packages/pkg");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      '{"name":"pkg","version":"1.0.0"}',
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      {
        command: "publish",
        cwd: packageDir,
        args: ["--dry-run"],
      },
      {
        log: vi.fn(),
        exit: vi.fn(),
      },
    );

    expect(store.getWorkspaces()).toEqual([
      { path: workspaceRoot, pinned: false, addedAt: expect.any(Number) },
    ]);
    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    expect(pending.payload.data.source).toEqual({ kind: "directory", path: packageDir });
  });

  // -------------------------------------------------------------------------
  // CLI parity (Chapter 7.1.2): pnpm-pub as a drop-in for `pnpm publish`.
  // -------------------------------------------------------------------------

  it("Scenario: Given the -m/--multi recursive aliases, When intercepted, Then they route to a recursive-publish event like -r", async () => {
    for (const recursiveAlias of ["-m", "--multi"]) {
      vi.resetAllMocks();
      const workspaceRoot = path.join(sandbox, `publish-multi-${recursiveAlias}`);
      const packageDir = path.join(workspaceRoot, "packages/pkg");
      await fsp.mkdir(packageDir, { recursive: true });
      await fsp.writeFile(
        path.join(workspaceRoot, "package.json"),
        JSON.stringify({ name: "root", version: "1.0.0", private: true }),
        "utf8",
      );
      await fsp.writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: "multi-pkg", version: "2.0.0" }),
        "utf8",
      );

      const store = new DaemonStore();
      await store.load();
      await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
      const scheduler = new PublishScheduler(store);

      hasPnpmMock.mockResolvedValue(true);
      listRecursivePackagesMock.mockResolvedValue([
        { name: "root", version: "1.0.0", path: workspaceRoot, private: true },
        { name: "multi-pkg", version: "2.0.0", path: packageDir, private: false },
      ]);

      await scheduler.intercept(
        { command: "publish", cwd: workspaceRoot, args: [recursiveAlias, "--no-git-checks"] },
        { log: vi.fn(), exit: vi.fn() },
      );

      const pending = store.getEvents().find((e) => e.status === "pending");
      expect(pending?.payload?.kind).toBe("recursive-publish");
    }
  });

  it("Scenario: Given the -F filter alias, When intercepted with a recursive publish, Then the alias is honored as a filter selector", async () => {
    const workspaceRoot = path.join(sandbox, "publish-filter-alias");
    const pkgA = path.join(workspaceRoot, "packages/a");
    const pkgB = path.join(workspaceRoot, "packages/b");
    await fsp.mkdir(pkgA, { recursive: true });
    await fsp.mkdir(pkgB, { recursive: true });
    await fsp.writeFile(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "root", version: "1.0.0", private: true }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(pkgA, "package.json"),
      JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      "utf8",
    );
    await fsp.writeFile(
      path.join(pkgB, "package.json"),
      JSON.stringify({ name: "pkg-b", version: "1.0.0" }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    hasPnpmMock.mockResolvedValue(true);
    listRecursivePackagesMock.mockResolvedValue([
      { name: "pkg-a", version: "1.0.0", path: pkgA, private: false },
      { name: "pkg-b", version: "1.0.0", path: pkgB, private: false },
    ]);

    await scheduler.intercept(
      { command: "publish", cwd: workspaceRoot, args: ["-r", "-F", "pkg-a", "--no-git-checks"] },
      { log: vi.fn(), exit: vi.fn() },
    );

    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.payload?.kind).toBe("recursive-publish");
    if (pending?.payload?.kind !== "recursive-publish") return;
    // -F pkg-a narrows the selection to pkg-a only; pkg-b is filtered out.
    expect(pending.payload.data.targets).toHaveLength(1);
    expect(pending.payload.data.targets[0]?.name).toBe("pkg-a");
  });

  it("Scenario: Given -C/--dir <path>, When intercepted, Then the effective cwd is overridden and the flag is stripped from forwarded args", async () => {
    const workspaceRoot = path.join(sandbox, "publish-dir-override");
    const targetDir = path.join(workspaceRoot, "pkg");
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(
      path.join(targetDir, "package.json"),
      JSON.stringify({ name: "dir-pkg", version: "3.1.4" }),
      "utf8",
    );

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    // Note: cwd is the workspace root, but -C points into pkg/.
    await scheduler.intercept(
      {
        command: "publish",
        cwd: workspaceRoot,
        args: ["-C", "./pkg", "--dry-run", "--no-git-checks"],
      },
      { log: vi.fn(), exit: vi.fn() },
    );

    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    // The publish source must resolve to the -C directory, not the original cwd.
    expect(pending.payload.data.source).toEqual({ kind: "directory", path: targetDir });
    expect(pending.payload.data.target.name).toBe("dir-pkg");
    // -C and its value are stripped from the forwarded argv (the subprocess cwd
    // is authoritative); --dry-run/--no-git-checks are preserved.
    expect(pending.payload.data.args).not.toContain("-C");
    expect(pending.payload.data.args).not.toContain("./pkg");
    expect(pending.payload.data.args).toEqual(
      expect.arrayContaining(["--dry-run", "--no-git-checks"]),
    );
  });

  it("Scenario: Given --provenance, When intercepted, Then a one-time advisory note is written to stderr and the flag is forwarded", async () => {
    const packageDir = path.join(sandbox, "publish-provenance");
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "prov-pkg", version: "1.0.0" }),
      "utf8",
    );
    const exit = vi.fn();
    const stderr: string[] = [];

    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "http://registry.test/" });
    const scheduler = new PublishScheduler(store);

    await scheduler.intercept(
      { command: "publish", cwd: packageDir, args: ["--provenance", "--no-git-checks"] },
      {
        log: (stream, data) => {
          if (stream === "stderr") stderr.push(data);
        },
        exit,
      },
    );

    // The flag is forwarded verbatim (drop-in parity).
    const pending = store.getEvents().find((e) => e.status === "pending");
    expect(pending?.payload?.kind).toBe("publish");
    if (pending?.payload?.kind !== "publish") return;
    expect(pending.payload.data.args).toContain("--provenance");
    // An advisory note about CI/OIDC is emitted exactly once on stderr.
    const note = stderr.join("");
    expect(note).toContain("--provenance");
    expect(note).toMatch(/CI|OIDC|trusted/i);
  });
});
