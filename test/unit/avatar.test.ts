/**
 * Avatar cache + resolution tests (Chapter 4.3).
 *
 * Resolution is delegated to `safe-npm-sdk`'s `lookupAvatar`; these tests mock
 * that boundary and assert the two layers pnpm-pub still owns: the
 * `lookupAvatar` → `NpmProfileIdentity` mapping, and the fetch/PNG-signature/
 * negative-cache machinery in `fetchAndCacheAvatar`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import {
  avatarCachePath,
  fetchAndCacheAvatar,
  hasCachedAvatar,
  lookupNpmProfileIdentity,
  trayIconForProfile,
} from "../../src/daemon/avatar.js";
import { setHomeOverride } from "../../src/shared/paths.js";
import type { AvatarLookup, Result } from "safe-npm-sdk";

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/**
 * Mocked `lookupAvatar`. Tests drive the avatar-resolution boundary by setting
 * `lookupAvatarMock.mockResolvedValue(...)`. `createClient` is a passthrough —
 * the client object is opaque to pnpm-pub and only handed back to the SDK.
 */
const sdkMocks = vi.hoisted(() => ({
  lookupAvatar: vi.fn(),
}));

vi.mock("safe-npm-sdk", () => ({
  createClient: (opts: unknown) => ({ __client: opts }),
  lookupAvatar: sdkMocks.lookupAvatar,
}));

/** Build an SDK-shaped success Result for an avatar lookup. */
function okResult(data: AvatarLookup): Result<AvatarLookup> {
  return { ok: true, data, response: {} } as Result<AvatarLookup>;
}

/** Build an SDK-shaped error Result (lookupAvatar errs only on client failure). */
function errResult(): Result<AvatarLookup> {
  return { ok: false, error: new Error("no client"), response: {} } as Result<AvatarLookup>;
}

const sandbox = path.join(os.tmpdir(), `pnpm-pub-avatar-${process.pid}-${Date.now()}`);

interface FetchCall {
  input: string | URL | Request;
  init?: RequestInit;
}

function stubFetch(responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fetch call");
    }
    return response;
  };
  vi.stubGlobal("fetch", fetchImpl);
  return calls;
}

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("fetchAndCacheAvatar", () => {
  it("Scenario: Given the SDK resolves no avatar, When fetching, Then no image fetch is attempted and a negative marker is written", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(
      okResult({
        username: "alice",
        registry: "https://registry.test",
        avatarUrl: null,
        source: "none",
      }),
    );

    await expect(fetchAndCacheAvatar("alice", "https://registry.test/")).resolves.toBeNull();
    await expect(fsp.access(avatarCachePath("alice"))).rejects.toBeTruthy();

    // A recent negative marker suppresses the next probe without calling the SDK.
    sdkMocks.lookupAvatar.mockClear();
    await expect(fetchAndCacheAvatar("alice", "https://registry.test/")).resolves.toBeNull();
    expect(sdkMocks.lookupAvatar).not.toHaveBeenCalled();
  });

  it("Scenario: Given the SDK resolves an avatar URL, When fetching, Then the PNG bytes are cached", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(
      okResult({
        username: "alice",
        registry: "https://registry.test",
        avatarUrl: "https://img.test/alice.png",
        source: "registry-profile",
      }),
    );
    const calls = stubFetch([
      new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } }),
    ]);

    await expect(fetchAndCacheAvatar("alice", "https://registry.test/")).resolves.toBe(
      avatarCachePath("alice"),
    );

    expect(calls.map((call) => String(call.input))).toEqual(["https://img.test/alice.png"]);
    await expect(fsp.readFile(avatarCachePath("alice"))).resolves.toEqual(pngBytes);
  });

  it("Scenario: Given the avatar URL returns JPEG bytes, When fetching for tray cache, Then it is not cached as PNG", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(
      okResult({
        username: "alice",
        registry: "https://registry.test",
        avatarUrl: "https://img.test/alice.jpg",
        source: "registry-profile",
      }),
    );
    stubFetch([
      new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } }),
    ]);

    await expect(fetchAndCacheAvatar("alice", "https://registry.test/")).resolves.toBeNull();
    await expect(fsp.access(avatarCachePath("alice"))).rejects.toBeTruthy();
  });

  it("Scenario: Given a stale JPEG file in the PNG avatar cache, When resolving a tray icon, Then the stale file is removed", async () => {
    await fsp.mkdir(path.dirname(avatarCachePath("alice")), { recursive: true });
    await fsp.writeFile(avatarCachePath("alice"), jpegBytes);

    expect(hasCachedAvatar("alice")).toBe(false);
    expect(trayIconForProfile("alice")).toBeNull();
    await expect(fsp.access(avatarCachePath("alice"))).rejects.toBeTruthy();
  });
});

describe("lookupNpmProfileIdentity", () => {
  it("Scenario: Given a token, When resolving, Then an authenticated client is built and the SDK result is mapped through", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(
      okResult({
        username: "alice",
        registry: "https://registry.test",
        avatarUrl: "https://img.test/alice.png",
        source: "authenticated-profile",
      }),
    );

    await expect(
      lookupNpmProfileIdentity("alice", "https://registry.test/", { token: "npm_token" }),
    ).resolves.toEqual({
      username: "alice",
      registry: "https://registry.test",
      avatarUrl: "https://img.test/alice.png",
      source: "authenticated-profile",
    });
  });

  it("Scenario: Given no token, When resolving, Then an anonymous client is used and a miss maps to source none", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(
      okResult({
        username: "alice",
        registry: "https://registry.test",
        avatarUrl: null,
        source: "none",
      }),
    );

    await expect(lookupNpmProfileIdentity("alice", "https://registry.test/")).resolves.toEqual({
      username: "alice",
      registry: "https://registry.test",
      avatarUrl: null,
      source: "none",
    });
  });

  it("Scenario: Given the SDK returns an error Result, When resolving, Then it degrades to source none without throwing", async () => {
    sdkMocks.lookupAvatar.mockResolvedValue(errResult());

    await expect(
      lookupNpmProfileIdentity("alice", "https://registry.test/", { token: "npm_token" }),
    ).resolves.toEqual({
      username: "alice",
      registry: "https://registry.test",
      avatarUrl: null,
      source: "none",
    });
  });

  it("Scenario: Given an empty username, When resolving, Then it short-circuits without calling the SDK", async () => {
    await expect(lookupNpmProfileIdentity("   ", "https://registry.test/")).resolves.toEqual({
      username: "",
      registry: "https://registry.test",
      avatarUrl: null,
      source: "none",
    });
    expect(sdkMocks.lookupAvatar).not.toHaveBeenCalled();
  });
});
