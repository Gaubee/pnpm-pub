/**
 * CLI fatal error projection tests (Chapter 7).
 */
import { describe, expect, it } from "vite-plus/test";
import { formatCliFatalError } from "../../src/cli/cli.js";

describe("CLI fatal error projection", () => {
  it("Scenario: Given an Error failure, When projecting fatal CLI text, Then the stack remains preferred", () => {
    const error = new Error("daemon crashed");

    expect(formatCliFatalError(error)).toContain("daemon crashed");
    expect(formatCliFatalError(error)).toContain("Error: daemon crashed");
  });

  it("Scenario: Given a non-Error failure, When projecting fatal CLI text, Then the source text is preserved", () => {
    expect(formatCliFatalError("socket handshake failed")).toBe("socket handshake failed");
  });
});
