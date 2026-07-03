/**
 * Feature: Renew route projection
 *
 * Scenario: Given an Event-backed or direct renew route, when WebUI renders copy,
 * then only explicit expired-token routes project token renewal.
 */
import { describe, expect, it, beforeAll } from "vite-plus/test";
import { addMessages, init } from "svelte-i18n";
import { getRenewProjection, toRenewReason } from "../../webui/src/lib/renew-projection.js";

beforeAll(() => {
  // svelte-i18n requires init before any formatMessage call.
  addMessages("en", {
    renew: {
      expiredHeading: "Renew Token",
      expiredIntro: "The current token has expired. Re-apply to continue publishing.",
      expiredTitle: "Renew Token · pnpm-pub",
      expiredSubmit: "Renew token",
      expiredBusy: "Renewing…",
      expiredError: "Renew failed.",
      credentialHeading: "Re-apply Credentials",
      credentialIntro: "Re-apply credentials before publishing can continue.",
      credentialTitle: "Re-apply Credentials · pnpm-pub",
      credentialSubmit: "Re-apply credentials",
      credentialBusy: "Re-applying…",
      credentialError: "Credential re-apply failed.",
    },
  });
  init({ fallbackLocale: "en", initialLocale: "en" });
});

describe("Feature: Renew route projection", () => {
  it("Scenario: Given renew route reasons, When projecting copy, Then only expired routes say Renew Token", () => {
    expect(toRenewReason("expired")).toBe("expired");
    expect(toRenewReason("action-required")).toBe("action-required");
    expect(toRenewReason(null)).toBe("direct");
    expect(toRenewReason("unexpected")).toBe("direct");

    expect(getRenewProjection("expired")).toMatchObject({
      heading: "Renew Token",
      documentTitle: "Renew Token · pnpm-pub",
      submitLabel: "Renew token",
      defaultError: "Renew failed.",
    });

    for (const reason of ["action-required", "direct"] as const) {
      expect(getRenewProjection(reason)).toMatchObject({
        heading: "Re-apply Credentials",
        documentTitle: "Re-apply Credentials · pnpm-pub",
        submitLabel: "Re-apply credentials",
        defaultError: "Credential re-apply failed.",
      });
    }
  });
});
