/**
 * Tests for the `verifyCredentials` wrapper (npm-api.ts).
 *
 * The wrapper delegates to the SDK's `verifyCredentials`, which probes the
 * registry with a read-only `listTokens` (and, when an OTP is supplied, a
 * phantom `deleteToken`). The SDK folds registry outcomes into a
 * `VerificationResult`:
 *   - 200              → authValid:true
 *   - 401/403 (bad)    → authValid:false  ← must surface as `code:'E401'`
 *   - EOTP/EAUTHIP     → authValid:true (restricted)
 *
 * These tests drive the wrapper through a mocked global `fetch` so the full
 * SDK → wrapper mapping is exercised (no SDK mock). The OTP is derived from a
 * fixed TOTP secret, so timing must be controlled by using a constant secret
 * and asserting only the wrapper's structural mapping, not the exact OTP.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { verifyCredentials } from "../../src/daemon/npm-api.js";

const fetchSpy = vi.spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
});

/** Build a minimal fetch Response. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Mock `fetch` to return a fresh Response per call (a Response body can only be
 * read once, and `verifyCredentials` makes two requests: listTokens + phantom
 * deleteToken). The factory is called for each fetch invocation.
 */
function mockFetchSequence(...factories: Array<() => Response>): void {
  let i = 0;
  fetchSpy.mockImplementation(async () => factories[Math.min(i++, factories.length - 1)]());
}

/** A valid (non-empty) token-list body the SDK's schema accepts. */
const TOKEN_LIST_BODY = { objects: [] };

describe("verifyCredentials wrapper", () => {
  it("Scenario: Given a valid token, When verifying, Then authValid is true and no code", async () => {
    // listTokens succeeds → auth valid, then the phantom deleteToken runs and
    // also succeeds (404 "not found" still means OTP passed; 200 is fine too).
    mockFetchSequence(
      () => jsonResponse(200, TOKEN_LIST_BODY),
      () => jsonResponse(200, TOKEN_LIST_BODY),
    );

    const result = await verifyCredentials({
      registry: "https://registry.example.test/",
      token: "valid-token",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    expect(result.ok).toBe(true);
    expect(result.check?.authValid).toBe(true);
    expect(result.check?.code).toBeUndefined();
  });

  it("Scenario: Given an expired token (401), When verifying, Then authValid is false and code is E401", async () => {
    // listTokens returns 401 → the SDK maps it to authValid:false and short-
    // circuits (no phantom deleteToken), so only one response is consumed.
    mockFetchSequence(() =>
      jsonResponse(401, { error: "Unable to authenticate", reason: "bad token" }),
    );

    const result = await verifyCredentials({
      registry: "https://registry.example.test/",
      token: "expired-token",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    // The SDK never returns `err` for credential checks (it folds them into a
    // VerificationResult), so the wrapper reports ok:true with authValid:false.
    expect(result.ok).toBe(true);
    expect(result.check?.authValid).toBe(false);
    // The wrapper surfaces a conventional E401 so callers can branch without
    // parsing the message — this is the fix for the lost `code`.
    expect(result.check?.code).toBe("E401");
  });
});
