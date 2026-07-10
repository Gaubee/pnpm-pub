import { describe, expect, it } from "vite-plus/test";
import { verifyReleaseVersion } from "../../scripts/release/verify-release.js";

describe("Feature: release version conservation", () => {
  it("Scenario: Given a matching release tag, When verification runs, Then it returns the package version", () => {
    expect(verifyReleaseVersion({ name: "pnpm-pub", version: "1.1.0" }, "v1.1.0")).toBe("1.1.0");
  });

  it("Scenario: Given a mismatched release tag, When verification runs, Then it rejects before publishing", () => {
    expect(() => verifyReleaseVersion({ name: "pnpm-pub", version: "1.1.0" }, "v1.0.0")).toThrow(
      "must equal v1.1.0",
    );
  });

  it("Scenario: Given invalid package metadata, When verification runs, Then it rejects the release", () => {
    expect(() => verifyReleaseVersion({ name: "other", version: "latest" }, "v1.1.0")).toThrow(
      "Invalid release package manifest",
    );
  });

  it("Scenario: Given a prerelease version, When verification runs, Then it cannot claim npm latest", () => {
    expect(() =>
      verifyReleaseVersion({ name: "pnpm-pub", version: "1.2.0-beta.1" }, "v1.2.0-beta.1"),
    ).toThrow("Invalid release package manifest");
  });
});
