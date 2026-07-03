/**
 * Renewal flow test (Chapter 6.2.4).
 *
 * Ensures the WebUI oRPC renewal endpoint reuses the stored TOTP secret and
 * does not blank it out when the UI submits only a password or a manual token.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { consumeEventIterator } from "@orpc/client";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { DaemonStore } from "../../src/daemon/store.js";
import { PublishScheduler } from "../../src/daemon/scheduler.js";
import { WebServer } from "../../src/daemon/web-server.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { exportBundle, importBundle } from "../../src/daemon/crypto.js";
import type { BackupBundle, WsServerMessage } from "../../src/shared/index.js";
import { isAbortError, openRpcClient, type WebRpcTestConnection } from "./orpc-test-client.js";

const mocks = vi.hoisted(() => ({
  applyTokenMock: vi.fn(),
  verifyCredentialsMock: vi.fn(),
  lookupNpmProfileIdentityMock: vi.fn(),
  setTokenMock: vi.fn(),
  setTotpSecretMock: vi.fn(),
  getTokenMock: vi.fn(),
  getTotpSecretMock: vi.fn(),
  deleteTokenMock: vi.fn(),
  deleteTotpSecretMock: vi.fn(),
  deleteProfileMock: vi.fn(),
  getProfileSecretsMock: vi.fn(),
  setProfileSecretsMock: vi.fn(),
  deleteProfileSecretsMock: vi.fn(),
}));

vi.mock("../../src/daemon/npm-api.js", () => ({
  applyToken: mocks.applyTokenMock,
  verifyCredentials: mocks.verifyCredentialsMock,
  publishPackage: vi.fn(),
  configureOidc: vi.fn(),
  isExpiredToken: vi.fn(),
}));

vi.mock("../../src/daemon/avatar.js", () => ({
  lookupNpmProfileIdentity: mocks.lookupNpmProfileIdentityMock,
}));

vi.mock("../../src/daemon/keychain.js", () => ({
  setToken: mocks.setTokenMock,
  setTotpSecret: mocks.setTotpSecretMock,
  getToken: mocks.getTokenMock,
  getTotpSecret: mocks.getTotpSecretMock,
  deleteToken: mocks.deleteTokenMock,
  deleteTotpSecret: mocks.deleteTotpSecretMock,
  deleteProfile: mocks.deleteProfileMock,
  getProfileSecrets: mocks.getProfileSecretsMock,
  setProfileSecrets: mocks.setProfileSecretsMock,
  deleteProfileSecrets: mocks.deleteProfileSecretsMock,
}));

const sandbox = path.join(os.tmpdir(), `pnpm-pub-renew-${process.pid}-${Date.now()}`);

type RenewWsEvidenceMessage = Extract<WsServerMessage, { type: "profiles" | "workspaces" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBackupBundle(value: unknown): value is BackupBundle {
  return (
    isRecord(value) &&
    Array.isArray(value.profiles) &&
    value.profiles.every((profile) => typeof profile === "string") &&
    typeof value.salt === "string" &&
    typeof value.iv === "string" &&
    typeof value.ciphertext === "string"
  );
}

function parseExportResponse(
  value: unknown,
): { ok: true; bundle: BackupBundle; skipped?: string[] } | null {
  if (!isRecord(value) || value.ok !== true || !isBackupBundle(value.bundle)) return null;
  if (value.skipped !== undefined) {
    if (!Array.isArray(value.skipped) || !value.skipped.every((entry) => typeof entry === "string"))
      return null;
    return { ok: true, bundle: value.bundle, skipped: value.skipped };
  }
  return { ok: true, bundle: value.bundle };
}

describe("renew flow keeps the stored secret", () => {
  let store: DaemonStore;
  let web: WebServer | null = null;
  let port = 0;

  beforeEach(async () => {
    vi.clearAllMocks();
    await fsp.rm(sandbox, { recursive: true, force: true });
    await fsp.mkdir(sandbox, { recursive: true });
    setHomeOverride(sandbox);
    mocks.getTokenMock.mockResolvedValue("old-token");
    mocks.getTotpSecretMock.mockResolvedValue("SECRET");
    // Credential verification succeeds by default (auth + OTP both valid).
    mocks.verifyCredentialsMock.mockResolvedValue({
      ok: true,
      status: 200,
      check: {
        authValid: true,
        requires2FA: true,
        otpValid: true,
        message: "auth valid, OTP valid",
      },
    });
    // Merged item mocks: by default, pool already has creds so these aren't read.
    mocks.getProfileSecretsMock.mockResolvedValue(null);
    mocks.setProfileSecretsMock.mockResolvedValue(undefined);
    mocks.deleteProfileSecretsMock.mockResolvedValue(undefined);
    mocks.lookupNpmProfileIdentityMock.mockImplementation((username: string, registry: string) =>
      Promise.resolve({
        username,
        registry: registry.replace(/\/$/, ""),
        avatarUrl: null,
        source: "none",
      }),
    );

    store = new DaemonStore();
    await store.load();
    await store.upsertProfile({ username: "alice", registry: "https://registry.npmjs.org/" });
    store.setCredentials("alice", { token: "old-token", totpSecret: "SECRET" });

    web = new WebServer({
      store,
      scheduler: new PublishScheduler(store),
      webToken: "webtoken",
      webuiDir: sandbox,
    });
    port = await web.start(0);
  });

  afterEach(async () => {
    await web?.stop();
    web = null;
    setHomeOverride(null);
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  async function withRpc<T>(run: (conn: WebRpcTestConnection) => Promise<T>): Promise<T> {
    const conn = await openRpcClient(port, "webtoken");
    try {
      return await run(conn);
    } finally {
      conn.close();
    }
  }

  it("uses the stored TOTP secret and preserves it on manual-token renew", async () => {
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: "npm_manual_renewed" });
    const json = await withRpc(({ client }) =>
      client.profile.renew({
        username: "alice",
        password: "ignored",
        manualToken: "npm_manual_renewed",
      }),
    );

    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).not.toHaveBeenCalled();
    // renewProfile now writes the merged item (not split setToken/setTotpSecret).
    expect(mocks.setProfileSecretsMock).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({
        npm_token: "npm_manual_renewed",
        totp_secret: "SECRET",
      }),
    );
    expect(store.getCredentials("alice")).toEqual({
      token: "npm_manual_renewed",
      totpSecret: "SECRET",
      npmPwd: "ignored",
    });
  });

  it("preserves non-Error add-profile persistence failure text", async () => {
    vi.spyOn(store, "upsertProfile").mockRejectedValueOnce("profile disk offline");
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);
    mocks.deleteProfileMock.mockResolvedValue(undefined);

    const json = await withRpc(({ client }) =>
      client.profile.add({
        username: "bob",
        password: "ignored",
        totpSecret: "BOBSECRET",
        manualToken: "npm_manual_bob",
      }),
    );

    expect(json).toEqual({
      ok: false,
      error: "Failed to persist profile: profile disk offline",
    });
    expect(mocks.deleteProfileMock).toHaveBeenCalledWith("bob");
    expect(store.getCredentials("bob")).toBeUndefined();
  });

  it("resolves npm profile identity through a token-guarded API", async () => {
    mocks.lookupNpmProfileIdentityMock.mockResolvedValueOnce({
      username: "bob",
      registry: "https://registry.npmjs.org",
      avatarUrl: "https://gravatar.com/avatar/bob?s=128&d=404",
      source: "maintainer-gravatar",
    });

    const json = await withRpc(({ client }) =>
      client.profile.lookupNpm({ username: "bob", registry: "https://registry.npmjs.org/" }),
    );

    expect(json).toEqual({
      ok: true,
      profile: {
        username: "bob",
        registry: "https://registry.npmjs.org",
        avatarUrl: "https://gravatar.com/avatar/bob?s=128&d=404",
        source: "maintainer-gravatar",
      },
    });
    expect(mocks.lookupNpmProfileIdentityMock).toHaveBeenCalledWith(
      "bob",
      "https://registry.npmjs.org/",
    );
  });

  it("persists a resolved avatar URL when adding a profile", async () => {
    mocks.lookupNpmProfileIdentityMock.mockResolvedValueOnce({
      username: "bob",
      registry: "https://registry.npmjs.org",
      avatarUrl: "https://gravatar.com/avatar/bob?s=128&d=404",
      source: "maintainer-gravatar",
    });
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);

    const json = await withRpc(({ client }) =>
      client.profile.add({
        username: "bob",
        password: "ignored",
        totpSecret: "BOBSECRET",
        manualToken: "npm_manual_bob",
      }),
    );

    expect(json).toEqual({ ok: true });
    expect(store.getProfile("bob")).toEqual({
      username: "bob",
      registry: "https://registry.npmjs.org/",
      avatarUrl: "https://gravatar.com/avatar/bob?s=128&d=404",
      authStatus: "authenticated",
      // New profiles opt into proactive token re-mint by default.
      autoRenew: true,
    });
  });

  it("restores the previous token and secret when persistence fails", async () => {
    vi.spyOn(store, "upsertProfile").mockRejectedValueOnce("persist failed");
    mocks.setTokenMock.mockResolvedValue(undefined);
    mocks.setTotpSecretMock.mockResolvedValue(undefined);

    const json = await withRpc(({ client }) =>
      client.profile.renew({
        username: "alice",
        password: "ignored",
        manualToken: "npm_manual_renewed",
      }),
    );

    expect(json.ok).toBe(false);
    expect(json.error).toBe("Failed to renew profile: persist failed");

    // Success path writes merged item; rollback restores via legacy split items.
    expect(mocks.setProfileSecretsMock).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({
        npm_token: "npm_manual_renewed",
      }),
    );
    // Rollback restores the old token via the split-item path.
    expect(mocks.setTokenMock).toHaveBeenCalledWith("alice", "old-token");
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith("alice", "SECRET");
    expect(mocks.deleteTokenMock).not.toHaveBeenCalled();
    expect(mocks.deleteTotpSecretMock).not.toHaveBeenCalled();
    expect(store.getCredentials("alice")).toEqual({
      token: "old-token",
      totpSecret: "SECRET",
    });
  });

  it("accepts a manual-token renew with a supplied TOTP secret when none is loaded", async () => {
    store.deleteCredentials("alice");
    mocks.getTotpSecretMock.mockResolvedValue(null);

    const json = await withRpc(({ client }) =>
      client.profile.renew({
        username: "alice",
        password: "ignored",
        manualToken: "npm_manual_renewed",
        totpSecret: "NEWSECRET",
      }),
    );

    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).not.toHaveBeenCalled();
    expect(mocks.setProfileSecretsMock).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({
        npm_token: "npm_manual_renewed",
        totp_secret: "NEWSECRET",
      }),
    );
    expect(store.getCredentials("alice")).toEqual({
      token: "npm_manual_renewed",
      totpSecret: "NEWSECRET",
      npmPwd: "ignored",
    });
  });

  it("uses a supplied TOTP secret for silent renew when none is loaded", async () => {
    store.deleteCredentials("alice");
    mocks.getTotpSecretMock.mockResolvedValue(null);
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: "npm_silent_renewed" });

    const json = await withRpc(({ client }) =>
      client.profile.renew({
        username: "alice",
        password: "fresh-password",
        totpSecret: "NEWSECRET",
      }),
    );

    expect(json).toEqual({ ok: true });

    expect(mocks.applyTokenMock).toHaveBeenCalledWith({
      registry: "https://registry.npmjs.org/",
      username: "alice",
      password: "fresh-password",
      totpSecret: "NEWSECRET",
    });
    expect(mocks.setProfileSecretsMock).toHaveBeenCalledWith(
      "alice",
      expect.objectContaining({
        npm_token: "npm_silent_renewed",
        totp_secret: "NEWSECRET",
        npm_pwd: "fresh-password",
      }),
    );
    expect(store.getCredentials("alice")).toEqual({
      token: "npm_silent_renewed",
      totpSecret: "NEWSECRET",
      npmPwd: "fresh-password",
    });
  });

  it("renews through the WebSocket RPC path without touching the obsolete HTTP body buffer", async () => {
    store.deleteCredentials("alice");
    mocks.getTotpSecretMock.mockResolvedValue(null);
    mocks.applyTokenMock.mockResolvedValue({ ok: true, token: "npm_silent_renewed" });
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");

    try {
      const json = await withRpc(({ client }) =>
        client.profile.renew({
          username: "alice",
          password: "fresh-password",
          totpSecret: "NEWSECRET",
        }),
      );

      expect(json).toEqual({ ok: true });
      expect(fillSpy).not.toHaveBeenCalled();
    } finally {
      fillSpy.mockRestore();
    }
  });

  it("exports profile credentials from keychain when the memory pool is empty", async () => {
    store.deleteCredentials("alice");
    // exportBundle now reads the merged item (getProfileSecrets) not split items.
    mocks.getProfileSecretsMock.mockResolvedValue({
      npm_token: "keychain-token",
      totp_secret: "KEYCHAINSECRET",
      npm_pwd: "stored-pwd",
    });

    const responseBody: unknown = await withRpc(({ client }) =>
      client.backup.export({ password: "backup-password" }),
    );

    const json = parseExportResponse(responseBody);
    expect(json).not.toBeNull();
    if (!json) throw new Error("Invalid export response");
    expect(json.ok).toBe(true);
    expect(json.skipped).toBeUndefined();
    const decoded = importBundle(json.bundle, "backup-password");
    expect(decoded?.alice).toEqual({ token: "keychain-token", totp: "KEYCHAINSECRET" });
    expect(store.getCredentials("alice")).toEqual({
      token: "keychain-token",
      totpSecret: "KEYCHAINSECRET",
    });
  });

  it("serves static assets with known MIME types and binary fallback for unknown extensions", async () => {
    await fsp.writeFile(path.join(sandbox, "style.css"), "body { color: red; }", "utf8");
    await fsp.writeFile(path.join(sandbox, "artifact.bin"), "opaque", "utf8");

    const css = await fetch(`http://127.0.0.1:${port}/style.css`);
    const bin = await fetch(`http://127.0.0.1:${port}/artifact.bin`);

    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    await expect(css.text()).resolves.toBe("body { color: red; }");
    expect(bin.status).toBe(200);
    expect(bin.headers.get("content-type")).toBe("application/octet-stream");
    await expect(bin.text()).resolves.toBe("opaque");
  });

  it("deletes a profile from a DELETE request body", async () => {
    const json = await withRpc(({ client }) => client.profile.delete({ username: "alice" }));

    expect(json).toEqual({ ok: true });
    expect(mocks.deleteProfileMock).toHaveBeenCalledWith("alice");
  });

  it("reports a missing profile from RPC delete without mutating profile truth", async () => {
    const json = await withRpc(({ client }) => client.profile.delete({ username: "ghost" }));

    expect(json).toEqual({ ok: false, error: "Profile ghost not found." });
    expect(mocks.deleteProfileMock).not.toHaveBeenCalledWith("ghost");
    expect(store.getProfiles().map((profile) => profile.username)).toEqual(["alice"]);
  });

  it("rejects an invalid import bundle payload", async () => {
    await expect(
      withRpc(({ rawCall }) =>
        rawCall(["backup", "import"], {
          bundle: { profiles: ["alice"], salt: "bad", iv: "bad" },
          password: "backup-password",
          usernames: ["alice"],
        }),
      ),
    ).rejects.toThrow();
  });

  it("rolls back imported keychain credentials when profile persistence fails", async () => {
    const bundle = exportBundle(
      {
        bob: { token: "imported-token", totp: "IMPORTEDSECRET" },
      },
      "backup-password",
    );
    vi.spyOn(store, "upsertProfile").mockRejectedValueOnce("profile disk offline");

    const json = await withRpc(({ client }) =>
      client.backup.import({
        bundle,
        password: "backup-password",
        usernames: ["bob"],
      }),
    );

    expect(json).toEqual({
      ok: false,
      error: "Failed to import profile bob: profile disk offline",
    });
    expect(mocks.setTokenMock).toHaveBeenCalledWith("bob", "imported-token");
    expect(mocks.setTotpSecretMock).toHaveBeenCalledWith("bob", "IMPORTEDSECRET");
    expect(mocks.deleteTokenMock).toHaveBeenCalledWith("bob");
    expect(mocks.deleteTotpSecretMock).toHaveBeenCalledWith("bob");
    expect(store.getCredentials("bob")).toBeUndefined();
    expect(store.getProfile("bob")).toBeUndefined();
  });

  it("re-broadcasts the workspace snapshot after a profile switch", async () => {
    await store.upsertProfile({ username: "bob" });
    await store.addWorkspace({ path: "/proj/a", pinned: false, addedAt: 1 });

    await withRpc(async ({ client }) => {
      const messages: RenewWsEvidenceMessage[] = [];
      const stop = consumeEventIterator(client.state.subscribe(), {
        onEvent(frame) {
          if (frame.type === "profiles" || frame.type === "workspaces") {
            messages.push(frame);
          }
        },
        onError(error) {
          if (!isAbortError(error)) throw error;
        },
      });

      await vi.waitFor(() => {
        expect(messages.some((m) => m.type === "workspaces")).toBe(true);
      });
      await client.profile.select({ username: "bob" });
      await vi.waitFor(() => {
        expect(messages.filter((m) => m.type === "workspaces")).toHaveLength(2);
      });
      await stop().catch((error: unknown) => {
        if (!isAbortError(error)) throw error;
      });

      const workspaces = messages.filter((m) => m.type === "workspaces");
      expect(workspaces[1]?.workspaces).toEqual([{ path: "/proj/a", pinned: false, addedAt: 1 }]);
      expect(messages.some((m) => m.type === "profiles" && m.default === "bob")).toBe(true);
    });
  });

  it("rejects malformed oRPC event actions before creating events", async () => {
    await expect(
      withRpc(({ rawCall }) =>
        rawCall(["events", "create"], {
          kind: "not-a-real-kind",
          payload: { name: "pkg" },
        }),
      ),
    ).rejects.toThrow();
    expect(store.getEvents()).toEqual([]);
  });

  it("rejects backup import/export as oRPC event actions", async () => {
    await expect(
      withRpc(({ rawCall }) => rawCall(["events", "create"], { kind: "export", payload: {} })),
    ).rejects.toThrow();
    expect(store.getEvents()).toEqual([]);
  });

  it("reports missing pending events for authenticated oRPC rejects", async () => {
    const json = await withRpc(({ client }) => client.events.reject({ id: "missing-task" }));

    expect(json).toEqual({ ok: false, error: "No such pending event." });
    expect(store.getEvents()).toEqual([]);
  });
});
