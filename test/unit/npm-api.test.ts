import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { applyToken, isExpiredToken, publishPackage } from "../../src/daemon/npm-api.js";

const npmProfileMocks = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  // applyToken now also calls these boundary helpers; mirror their behaviour
  // for the plain Errors/strings the tests throw (non-auth → not a fallback).
  isManualTokenFallbackError: vi.fn(() => false),
  resultErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
}));

vi.mock("../../src/daemon/npm-profile-client.js", () => ({
  loginWithPassword: npmProfileMocks.loginWithPassword,
  isManualTokenFallbackError: npmProfileMocks.isManualTokenFallbackError,
  resultErrorMessage: npmProfileMocks.resultErrorMessage,
}));

const fetchSpy = vi.spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
  vi.clearAllMocks();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

describe("applyToken (Chapter 8.1)", () => {
  it("Scenario: Given credentials, When applying a token, Then npm-profile login creates the credential fact", async () => {
    npmProfileMocks.loginWithPassword.mockResolvedValue({
      token: "npm_generated",
      username: "alice",
    });

    await expect(
      applyToken({
        registry: "https://registry.example.test/",
        username: "alice",
        password: "secret-password",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).resolves.toEqual({
      ok: true,
      token: "npm_generated",
    });

    expect(npmProfileMocks.loginWithPassword).toHaveBeenCalledWith(
      "alice",
      "secret-password",
      expect.objectContaining({
        registry: "https://registry.example.test/",
        otp: expect.stringMatching(/^\d{6}$/),
      }),
    );
  });

  it("Scenario: Given npm-profile returns no login token, When applying a token, Then no credential fact is accepted", async () => {
    npmProfileMocks.loginWithPassword.mockRejectedValue(
      new Error("npm-profile login returned no token."),
    );

    await expect(
      applyToken({
        registry: "https://registry.example.test/",
        username: "alice",
        password: "secret-password",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).resolves.toEqual({ ok: false, error: "npm-profile login returned no token." });
  });

  it("Scenario: Given npm rejects login, When applying a token, Then manual token fallback is requested", async () => {
    const error = new Error("Unauthorized");
    npmProfileMocks.loginWithPassword.mockRejectedValue(error);
    // The boundary's own isManualTokenFallbackError decides the fallback path;
    // fake it returning true for this auth-rejection scenario.
    npmProfileMocks.isManualTokenFallbackError.mockReturnValueOnce(true);

    await expect(
      applyToken({
        registry: "https://registry.example.test/",
        username: "alice",
        password: "secret-password",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).resolves.toEqual({ ok: false, needsManualToken: true, error: "Unauthorized" });
  });

  it("Scenario: Given fetch rejects with a non-Error value, When applying a token, Then the failure is projected without casts", async () => {
    npmProfileMocks.loginWithPassword.mockRejectedValue("network unavailable");

    await expect(
      applyToken({
        registry: "https://registry.example.test/",
        username: "alice",
        password: "secret-password",
        totpSecret: "JBSWY3DPEHPK3PXP",
      }),
    ).resolves.toEqual({ ok: false, error: "network unavailable" });
  });

  it("Scenario: Given credentials, When applying a token, Then the local password buffer is zeroed", async () => {
    npmProfileMocks.loginWithPassword.mockResolvedValue({
      token: "npm_generated",
      username: "alice",
    });
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");

    try {
      await applyToken({
        registry: "https://registry.example.test/",
        username: "alice",
        password: "secret-password",
        totpSecret: "JBSWY3DPEHPK3PXP",
      });

      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
    }
  });
});

describe("publishPackage dist-tag document", () => {
  it("Scenario: Given a publish distTag, When publishing, Then the registry document uses that dist-tag instead of latest", async () => {
    let capturedBody: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      if (typeof init?.body === "string") capturedBody = init.body;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      publishPackage({
        registry: "https://registry.example.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "pkg",
        version: "1.0.0",
        tarball: Buffer.from("hello"),
        metadata: { name: "pkg", version: "1.0.0" },
        distTag: "beta",
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedBody).not.toBeNull();
    if (capturedBody === null) throw new Error("Expected publish request body");
    const parsed: unknown = JSON.parse(capturedBody);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    expect(readRecordField(parsed, "dist-tags")).toEqual({ beta: "1.0.0" });
  });

  it("Scenario: Given a publish access value, When publishing, Then the registry document includes access", async () => {
    let capturedBody: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      if (typeof init?.body === "string") capturedBody = init.body;
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      publishPackage({
        registry: "https://registry.example.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "@scope/pkg",
        version: "1.0.0",
        tarball: Buffer.from("hello"),
        metadata: { name: "@scope/pkg", version: "1.0.0" },
        access: "public",
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedBody).not.toBeNull();
    if (capturedBody === null) throw new Error("Expected publish request body");
    const parsed: unknown = JSON.parse(capturedBody);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    expect(parsed.access).toBe("public");
  });

  it("Scenario: Given a publish OTP value, When publishing, Then the registry request uses that OTP", async () => {
    let capturedOtp: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      capturedOtp = new Headers(init?.headers).get("npm-otp");
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      publishPackage({
        registry: "https://registry.example.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "pkg",
        version: "1.0.0",
        tarball: Buffer.from("hello"),
        metadata: { name: "pkg", version: "1.0.0" },
        otp: "123456",
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedOtp).toBe("123456");
  });

  it("Scenario: Given an explicit publish OTP fails, When the registry returns a drift hint, Then no stored-secret retry is attempted", async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ error: "OTP validation failed" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          date: new Date(Date.now() + 90_000).toUTCString(),
        },
      });
    });

    await expect(
      publishPackage({
        registry: "https://registry.example.test/",
        token: "npm_token",
        totpSecret: "JBSWY3DPEHPK3PXP",
        name: "pkg",
        version: "1.0.0",
        tarball: Buffer.from("hello"),
        metadata: { name: "pkg", version: "1.0.0" },
        otp: "123456",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      // The SDK appends a request-description suffix (method+url+body +
      // auth/otp status) to the message, so match the leading text only.
      error: expect.stringContaining("OTP validation failed"),
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("registry response body projection", () => {
  it("Scenario: Given an unstringifiable registry body, When classifying token expiry, Then no projection error escapes", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => isExpiredToken(403, circular)).not.toThrow();
    expect(isExpiredToken(403, circular)).toBe(false);
  });

});
