/**
 * profile.otp RPC — daemon-side TOTP generation for the Profile detail OTP button.
 *
 * Boots a real WebServer against an in-memory keychain mock and exercises the
 * `profile.otp` route: code shape, remainingSec bounds, the no-secret disabled
 * case, and that the emitted 6-digit code matches otplib's own computation for
 * the same secret + window (so the WebUI always shows the right code).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { authenticator } from "otplib";
import { DaemonStore } from "../../src/daemon/store.js";
import { PublishScheduler } from "../../src/daemon/scheduler.js";
import { WebServer } from "../../src/daemon/web-server.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import { openRpcClient } from "./orpc-test-client.js";

// In-memory keytar stub (mirrors ws-profile-authstatus.test.ts).
const kcStore = new Map<string, string>();
const kcKey = (s: string, a: string) => `${s}:${a}`;
const SERVICE = "pnpm-pub-test-sandbox";
const inMemoryKeytar = {
  async setPassword(s: string, a: string, p: string) {
    kcStore.set(kcKey(s, a), p);
  },
  async getPassword(s: string, a: string) {
    return kcStore.get(kcKey(s, a)) ?? null;
  },
  async deletePassword(s: string, a: string) {
    return kcStore.delete(kcKey(s, a));
  },
  async findCredentials(s: string) {
    const out: { account: string; password: string }[] = [];
    for (const [k, v] of kcStore)
      if (k.startsWith(`${s}:`)) out.push({ account: k.slice(s.length + 1), password: v });
    return out;
  },
  async findPassword() {
    return null;
  },
};

vi.mock("../../src/daemon/keychain.js", () => ({
  __setKeytarForTest: (_api: unknown) => {},
  useSandboxService: () => {},
  resetService: () => {},
  activeService: () => SERVICE,
  setToken: async (u: string, v: string) => {
    kcStore.set(kcKey(SERVICE, `${u}_npm_token`), v);
  },
  getToken: async (u: string) => kcStore.get(kcKey(SERVICE, `${u}_npm_token`)) ?? null,
  deleteToken: async (u: string) => {
    kcStore.delete(kcKey(SERVICE, `${u}_npm_token`));
  },
  setTotpSecret: async (u: string, v: string) => {
    kcStore.set(kcKey(SERVICE, `${u}_totp_secret`), v);
  },
  getTotpSecret: async (u: string) => kcStore.get(kcKey(SERVICE, `${u}_totp_secret`)) ?? null,
  deleteTotpSecret: async (u: string) => {
    kcStore.delete(kcKey(SERVICE, `${u}_totp_secret`));
  },
  deleteProfile: async (u: string) => {
    kcStore.delete(kcKey(SERVICE, `pnpm_pub-key${u}-auth`));
    kcStore.delete(kcKey(SERVICE, `${u}_npm_token`));
    kcStore.delete(kcKey(SERVICE, `${u}_totp_secret`));
  },
  getProfileSecrets: async (u: string) => {
    const raw = kcStore.get(kcKey(SERVICE, `pnpm_pub-key${u}-auth`));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setProfileSecrets: async (
    u: string,
    s: { npm_token: string; totp_secret: string; npm_pwd: string },
  ) => {
    kcStore.set(kcKey(SERVICE, `pnpm_pub-key${u}-auth`), JSON.stringify(s));
  },
  deleteProfileSecrets: async (u: string) => {
    kcStore.delete(kcKey(SERVICE, `pnpm_pub-key${u}-auth`));
  },
}));

import {
  setProfileSecrets as setSecrets,
  useSandboxService,
  __setKeytarForTest,
  resetService,
} from "../../src/daemon/keychain.js";

const sandbox = path.join(os.tmpdir(), `pnpm-pub-otp-${process.pid}-${Date.now()}`);
const WEB_TOKEN = "otp-webtoken";

// A well-known Base32 secret (RFC 6238 test vector digits use this seed family).
const SECRET = "JBSWY3DPEHPK3PXP";

describe("profile.otp RPC", () => {
  let store: DaemonStore;
  let web: WebServer;
  let port: number;

  beforeEach(async () => {
    kcStore.clear();
    useSandboxService();
    __setKeytarForTest(inMemoryKeytar);
    await fsp.rm(sandbox, { recursive: true, force: true });
    await fsp.mkdir(sandbox, { recursive: true });
    setHomeOverride(sandbox);

    store = new DaemonStore();
    await store.load();
    // Seed a profile with a merged keychain item (TOTP secret present).
    await setSecrets("alice", { npm_token: "npm_alice", totp_secret: SECRET, npm_pwd: "pw" });
    await store.upsertProfile({ username: "alice", registry: "https://registry.npmjs.org/" });
    // Seed a profile with NO secret (2FA not configured).
    await store.upsertProfile({ username: "bob", registry: "https://registry.npmjs.org/" });

    web = new WebServer({
      store,
      scheduler: new PublishScheduler(store),
      webToken: WEB_TOKEN,
      webuiDir: sandbox,
    });
    port = await web.start(0);
  });

  afterEach(async () => {
    await web.stop();
    __setKeytarForTest(null);
    resetService();
    setHomeOverride(null);
    await fsp.rm(sandbox, { recursive: true, force: true });
  });

  it("returns a 6-digit code, valid remainingSec, and a fresh epochMs", async () => {
    const conn = await openRpcClient(port, WEB_TOKEN);
    try {
      const before = Date.now();
      const res = await conn.client.profile.otp({ username: "alice" });
      const after = Date.now();

      expect(res.ok).toBe(true);
      expect(res.code).toMatch(/^\d{6}$/);
      expect(res.configured).toBe(true);
      expect(res.remainingSec).toBeGreaterThanOrEqual(1);
      expect(res.remainingSec).toBeLessThanOrEqual(30);
      // epochMs is the daemon wall-clock at generation time — must fall inside
      // the call window (no time travel).
      expect(res.epochMs).toBeGreaterThanOrEqual(before);
      expect(res.epochMs).toBeLessThanOrEqual(after);
    } finally {
      conn.close();
    }
  });

  it("emits the same code as otplib for the current window", async () => {
    const conn = await openRpcClient(port, WEB_TOKEN);
    try {
      const res = await conn.client.profile.otp({ username: "alice" });
      // Cross-check against otplib's authenticator (same opts: 6 digits / 30s).
      expect(res.code).toBe(authenticator.generate(SECRET));
    } finally {
      conn.close();
    }
  });

  it("reports configured:false when no TOTP secret is stored", async () => {
    const conn = await openRpcClient(port, WEB_TOKEN);
    try {
      const res = await conn.client.profile.otp({ username: "bob" });
      expect(res.ok).toBe(false);
      expect(res.configured).toBe(false);
      expect(res.code).toBeUndefined();
      expect(res.error).toBeTruthy();
    } finally {
      conn.close();
    }
  });

  it("works for a non-default profile (keyed by username)", async () => {
    const conn = await openRpcClient(port, WEB_TOKEN);
    try {
      // alice is not the default profile here.
      const res = await conn.client.profile.otp({ username: "alice" });
      expect(res.ok).toBe(true);
      expect(res.code).toBe(authenticator.generate(SECRET));
    } finally {
      conn.close();
    }
  });

  it("warms the in-memory credential pool on the first read", async () => {
    const conn = await openRpcClient(port, WEB_TOKEN);
    try {
      // Pool is empty for alice before the call.
      expect(store.getCredentials("alice")).toBeUndefined();
      await conn.client.profile.otp({ username: "alice" });
      // After the call the pool carries the secret (no keychain re-read needed).
      const pool = store.getCredentials("alice");
      expect(pool?.totpSecret).toBe(SECRET);
    } finally {
      conn.close();
    }
  });

  it("rejects without a valid WebToken", async () => {
    // A bad token never completes the WS upgrade — the socket errors out.
    await expect(openRpcClient(port, "wrong-token")).rejects.toThrow();
  });
});
