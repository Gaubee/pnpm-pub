import { describe, expect, it } from "vitest";
import { normalizeNpmPackageName, validateNpmPackageName } from "../../src/shared/package-name.js";

describe("Feature: npm package identity", () => {
  it("Scenario: Given mixed-case input, When normalized, Then only casing is repaired", () => {
    expect(normalizeNpmPackageName("@Scope/My-Package ")).toBe("@scope/my-package ");
  });

  it("Scenario: Given valid scoped and unscoped names, When validated, Then npm accepts them", () => {
    expect(validateNpmPackageName("pnpm-pub")).toMatchObject({
      name: "pnpm-pub",
      valid: true,
    });
    expect(validateNpmPackageName("@Gaubee/PNPM-PUB")).toMatchObject({
      name: "@gaubee/pnpm-pub",
      valid: true,
    });
  });

  it("Scenario: Given invalid or reserved names, When validated, Then creation is rejected", () => {
    expect(validateNpmPackageName("bad name").valid).toBe(false);
    expect(validateNpmPackageName("node_modules").valid).toBe(false);
    expect(validateNpmPackageName("http").valid).toBe(false);
  });
});
