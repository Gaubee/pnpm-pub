/**
 * Daemon store tests — config persistence, events, credential pool isolation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { DaemonStore } from "../../src/daemon/store.js";
import { appDir, profilesPath, setHomeOverride, workspacesPath } from "../../src/shared/paths.js";
import type { Preferences } from "../../src/shared/index.js";
import { promises as fsp } from "node:fs";

const sandbox = path.join(os.tmpdir(), `pnpm-pub-test-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(async () => {
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("DaemonStore profiles (Chapter 4.1)", () => {
  it("starts empty and persists upserts", async () => {
    const store = new DaemonStore();
    await store.load();
    expect(store.getProfiles()).toEqual([]);
    await store.upsertProfile({ username: "alice" });
    const reloaded = new DaemonStore();
    await reloaded.load();
    expect(reloaded.getProfiles().map((p) => p.username)).toEqual(["alice"]);
    expect(reloaded.getDefault()).toBe("alice");
  });

  it("emits a profiles event on change", async () => {
    const store = new DaemonStore();
    await store.load();
    const seen: string[] = [];
    store.on("profiles", (msg) => seen.push(msg.type));
    await store.upsertProfile({ username: "bob" });
    expect(seen).toContain("profiles");
  });

  it("removes a profile and clears its credentials", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    store.setCredentials("alice", { token: "t", totpSecret: "s" });
    await expect(store.removeProfile("alice")).resolves.toBe(true);
    expect(store.getProfiles()).toEqual([]);
    expect(store.getCredentials("alice")).toBeUndefined();
  });

  it("Scenario: Given multiple profiles, When deleting the default profile, Then default moves to the next profile source", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    await store.upsertProfile({ username: "work" });

    await expect(store.removeProfile("alice")).resolves.toBe(true);

    expect(store.getProfiles().map((profile) => profile.username)).toEqual(["work"]);
    expect(store.getDefault()).toBe("work");
  });

  it("Scenario: Given an unknown profile, When removing it, Then profile truth is unchanged", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const seen: string[] = [];
    store.on("profiles", (msg) => seen.push(msg.type));

    await expect(store.removeProfile("ghost")).resolves.toBe(false);

    expect(store.getProfiles().map((profile) => profile.username)).toEqual(["alice"]);
    expect(store.getDefault()).toBe("alice");
    expect(seen).toEqual([]);
  });

  it("Scenario: Given an unknown profile, When selecting default, Then profile truth is unchanged", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });

    await expect(store.setDefault("ghost")).resolves.toBe(false);

    expect(store.getDefault()).toBe("alice");
    const reloaded = new DaemonStore();
    await reloaded.load();
    expect(reloaded.getDefault()).toBe("alice");
  });

  it("Scenario: Given malformed profiles.json, When loading, Then profile truth falls back to empty config", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({ default: "ghost", profiles: [{ username: 42 }] }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe("");
  });

  it("Scenario: Given profiles.json with an orphan default, When loading, Then default points at a profile source", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({
        default: "ghost",
        profiles: [{ username: "alice" }, { username: "work" }],
      }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles().map((profile) => profile.username)).toEqual(["alice", "work"]);
    expect(store.getDefault()).toBe("alice");
  });

  it("Scenario: Given profiles.json with an empty username, When loading, Then profile truth falls back to empty config", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({ default: "", profiles: [{ username: "" }] }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe("");
  });

  it("Scenario: Given profiles.json with duplicate usernames, When loading, Then profile truth falls back to empty config", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      profilesPath(),
      JSON.stringify({
        default: "alice",
        profiles: [
          { username: "alice" },
          { username: "alice", registry: "https://registry.example/" },
        ],
      }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getProfiles()).toEqual([]);
    expect(store.getDefault()).toBe("");
  });
});

describe("DaemonStore events (Chapter 6.2)", () => {
  it("creates pending events in newest-first order", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice" });
    const a = store.createEvent({ kind: "publish", profile: "alice" });
    const b = store.createEvent({ kind: "publish", profile: "alice" });
    const list = store.getEvents();
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
    expect(list.every((e) => e.status === "pending")).toBe(true);
  });

  it("resolves events and records the result", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({ kind: "publish", profile: "alice" });
    store.resolveEvent(evt.id, "success", "published @scope/x@1.0.0");
    const resolved = store.getEvent(evt.id);
    expect(resolved?.status).toBe("success");
    expect(resolved?.result).toBe("published @scope/x@1.0.0");
    expect(resolved?.resolvedAt).toBeTypeOf("number");
  });

  it("Scenario: Given clock drift recovery metadata, When resolving, Then only the named resolution fact is recorded", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({ kind: "publish", profile: "alice" });

    store.resolveEvent(evt.id, "success", "published @scope/x@1.0.0", {
      clockDriftRecovered: true,
    });

    const resolved = store.getEvent(evt.id);
    expect(resolved?.status).toBe("success");
    expect(resolved?.clockDriftRecovered).toBe(true);
    expect(resolved?.createdAt).toBe(evt.createdAt);
  });

  it("Scenario: Given a pending publish event, When updating args, Then the args are mutated on the live event", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({
      kind: "publish",
      profile: "alice",
      payload: {
        kind: "publish",
        data: {
          source: { kind: "directory", path: "/p" },
          args: ["--access", "public"],
          target: { name: "pkg", version: "1.0.0", path: "/p" },
        },
      },
    });
    const updated = store.updateEventArgs(evt.id, ["--access", "restricted", "--no-git-checks"]);
    expect(updated?.payload?.kind).toBe("publish");
    if (updated?.payload?.kind === "publish") {
      expect(updated.payload.data.args).toEqual(["--access", "restricted", "--no-git-checks"]);
    }
    // The SAME event object in the store reflects the mutation.
    expect(store.getEvent(evt.id)?.payload?.kind).toBe("publish");
  });

  it("Scenario: Given a pending recursive-publish event, When updating args, Then the args are mutated (parity with publish)", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({
      kind: "recursive-publish",
      profile: "alice",
      payload: {
        kind: "recursive-publish",
        data: {
          source: { kind: "directory", path: "/ws" },
          args: ["-r", "--no-git-checks"],
          targets: [{ name: "pkg", version: "1.0.0", path: "/ws/pkg" }],
        },
      },
    });
    const updated = store.updateEventArgs(evt.id, ["-r", "--access", "restricted"]);
    expect(updated).toBeTruthy();
    if (updated?.payload?.kind === "recursive-publish") {
      expect(updated.payload.data.args).toEqual(["-r", "--access", "restricted"]);
    }
  });

  it("Scenario: Given a non-publish event (configure-trust), When updating args, Then it is rejected (undefined)", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({
      kind: "configure-trust",
      profile: "alice",
      payload: {
        kind: "configure-trust",
        data: { action: "add", target: { name: "@scope/pkg", path: "/p", repository: "o/r" } },
      },
    });
    expect(store.updateEventArgs(evt.id, ["--access", "public"])).toBeUndefined();
  });

  it("Scenario: Given grouped configure-trust events, When updating the draft, Then every pending group member receives it", async () => {
    const store = new DaemonStore();
    await store.load();
    const groupId = "configure-trust-group";
    const first = store.createEvent({
      kind: "configure-trust",
      profile: "alice",
      groupId,
      payload: {
        kind: "configure-trust",
        data: { action: "add", target: { name: "@scope/a", path: "/a", repository: "o/r" } },
      },
    });
    const second = store.createEvent({
      kind: "configure-trust",
      profile: "alice",
      groupId,
      payload: {
        kind: "configure-trust",
        data: { action: "update", target: { name: "@scope/b", path: "/b", repository: "o/r" } },
      },
    });
    const config = {
      type: "github" as const,
      permissions: ["createPackage" as const],
      claims: { repository: "o/r", workflow_ref: { file: "publish.yml" } },
    };

    const updated = store.updateConfigureTrustGroupDraft(groupId, config);

    expect(updated.map((event) => event.id).sort()).toEqual([first.id, second.id].sort());
    for (const event of [first, second]) {
      expect(event.payload?.kind).toBe("configure-trust");
      if (event.payload?.kind === "configure-trust") {
        expect(event.payload.data.config).toEqual(config);
      }
    }
  });

  it("Scenario: Given a resolved publish event, When updating args, Then it is rejected (not pending)", async () => {
    const store = new DaemonStore();
    await store.load();
    const evt = store.createEvent({
      kind: "publish",
      profile: "alice",
      payload: {
        kind: "publish",
        data: {
          source: { kind: "directory", path: "/p" },
          args: [],
          target: { name: "pkg", version: "1.0.0", path: "/p" },
        },
      },
    });
    store.resolveEvent(evt.id, "success", "done");
    expect(store.updateEventArgs(evt.id, ["--access", "public"])).toBeUndefined();
  });
});

describe("DaemonStore preferences (Chapter 6.4)", () => {
  it("defaults keepOnTop to false on first run (no file)", async () => {
    const store = new DaemonStore();
    await store.load();
    expect(store.getPreferences()).toEqual({ keepOnTop: false, values: {} });
  });

  it("persists keepOnTop across reloads", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.setPreferences({ keepOnTop: true });

    const reloaded = new DaemonStore();
    await reloaded.load();
    expect(reloaded.getPreferences().keepOnTop).toBe(true);
  });

  it("emits a preferences event on change (and not on no-op)", async () => {
    const store = new DaemonStore();
    await store.load();
    const seen: Preferences[] = [];
    store.on("preferences", (prefs: Preferences) => seen.push(prefs));
    await store.setPreferences({ keepOnTop: true });
    await store.setPreferences({ keepOnTop: true }); // no-op, no second emit
    expect(seen).toEqual([{ keepOnTop: true, values: {} }]);
  });

  it("Scenario: Given free-form UI preference values, When patched independently, Then existing keys are conserved", async () => {
    const store = new DaemonStore();
    await store.load();
    await store.setPreferences({ values: { "trustedPublishing.formMode": "compact" } });
    await store.setPreferences({ values: { "other.preference": true } });

    expect(store.getPreferences().values).toEqual({
      "trustedPublishing.formMode": "compact",
      "other.preference": true,
    });
  });
});

describe("DaemonStore risk-boundary state machine (Chapter 5.3.2)", () => {
  it("Scenario: Given a risky workspace, When staged, Then the confirmation token is not the path", async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({
      path: "/Users/x/Downloads",
      pinned: false,
      addedAt: 1,
    });
    expect(token).not.toBe("/Users/x/Downloads");
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    // Nothing written yet.
    expect(store.getWorkspaces()).toEqual([]);
    expect(store.getStagedRiskyWorkspaces().map((w) => w.path)).toContain("/Users/x/Downloads");
  });

  it("Scenario: Given a staged risky workspace, When confirmed by opaque token, Then it persists once", async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: "/risky", pinned: false, addedAt: 2 });
    await expect(store.confirmRiskyWorkspace("/risky")).resolves.toBe(false);
    expect(store.getWorkspaces()).toEqual([]);
    const confirmed = await store.confirmRiskyWorkspace(token);
    expect(confirmed).toBe(true);
    expect(store.getWorkspaces().map((w) => w.path)).toContain("/risky");
    // Token consumed — a second confirm fails.
    const again = await store.confirmRiskyWorkspace(token);
    expect(again).toBe(false);
  });

  it("cancel discards a staged risky workspace without persisting", async () => {
    const store = new DaemonStore();
    await store.load();
    const token = store.stageRiskyWorkspace({ path: "/risky2", pinned: false, addedAt: 3 });
    store.cancelRiskyWorkspace(token);
    expect(store.getStagedRiskyWorkspaces()).toEqual([]);
    expect(store.getWorkspaces()).toEqual([]);
  });

  it("Scenario: Given runtime workspace input with extra projection fields, When stored, Then only workspace ontology fields persist", async () => {
    const store = new DaemonStore();
    await store.load();
    const root = path.join(sandbox, "workspace");
    // First insert with pinned=false/addedAt=1; the extra projection field
    // (displayName) must be stripped to only workspace ontology fields.
    // Cast to bypass the excess-property check on purpose — the point of the
    // test is that the store ignores unknown keys.
    const entryWithExtra = {
      path: root,
      pinned: false,
      addedAt: 1,
      displayName: "Workspace",
    } as unknown as Parameters<DaemonStore["addWorkspace"]>[0];
    await store.addWorkspace(entryWithExtra);

    const [workspace] = store.getWorkspaces();
    expect(workspace).toEqual({ path: root, pinned: false, addedAt: 1 });
    expect("displayName" in workspace!).toBe(false);
  });

  it("Scenario: Given a tracked pinned workspace, When addWorkspace is re-called (re-scan / auto-collect) with pinned:false, Then the user-set pin and original addedAt are preserved", async () => {
    const root = path.join(sandbox, "pinned-repo");
    const store = new DaemonStore();
    await store.load();

    await store.addWorkspace({ path: root, pinned: true, addedAt: 1_000 });
    // Simulate the WorkspaceDetail scan-on-mount / scheduler auto-collect path,
    // which always supplies pinned:false and a fresh addedAt.
    await store.addWorkspace({ path: root, pinned: false, addedAt: 9_999 });

    const [workspace] = store.getWorkspaces();
    expect(workspace).toEqual({ path: root, pinned: true, addedAt: 1_000 });

    // Persistence: a freshly-loaded store must still see the preserved pin.
    const reloaded = new DaemonStore();
    await reloaded.load();
    const [persisted] = reloaded.getWorkspaces();
    expect(persisted).toEqual({ path: root, pinned: true, addedAt: 1_000 });
  });

  it("Scenario: Given malformed workspaces.json, When loading, Then workspace truth falls back to empty config", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: "/proj", pinned: "yes", addedAt: 1 }] }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it("Scenario: Given workspaces.json with a relative path, When loading, Then workspace truth falls back to empty config", async () => {
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: "packages/widget", pinned: false, addedAt: 1 }] }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it("Scenario: Given workspaces.json with duplicate root paths, When loading, Then workspace truth falls back to empty config", async () => {
    const root = path.join(sandbox, "repo");
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({
        paths: [
          { path: root, pinned: false, addedAt: 1 },
          { path: root, pinned: true, addedAt: 2 },
        ],
      }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });

  it("Scenario: Given workspaces.json with an invalid timestamp, When loading, Then workspace truth falls back to empty config", async () => {
    const root = path.join(sandbox, "repo");
    await fsp.mkdir(appDir(), { recursive: true });
    await fsp.writeFile(
      workspacesPath(),
      JSON.stringify({ paths: [{ path: root, pinned: false, addedAt: -1 }] }),
      "utf8",
    );
    const store = new DaemonStore();

    await store.load();

    expect(store.getWorkspaces()).toEqual([]);
  });
});
