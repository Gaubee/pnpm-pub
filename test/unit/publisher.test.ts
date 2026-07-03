/**
 * Unit tests for the `pnpm publish` subprocess publisher's pure helpers and
 * the temporary `.npmrc` snapshot/restore lifecycle.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import {
  stripOverriddenArgs,
  ensureRecursive,
  mergeAuthIntoNpmrc,
  registryAuthPrefix,
  parseRecursivePackageList,
  PnpmNotOnPathError,
} from "../../src/daemon/publisher.js";
import { withTempNpmrc } from "../../src/daemon/npmrc-auth.js";
import { combinePublishDiagnostics, extractNpmError } from "../../src/daemon/subprocess-runner.js";

const sandbox = path.join(os.tmpdir(), `pnpm-pub-pub-${process.pid}-${Date.now()}`);

afterEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Feature: publisher arg stripping (no duplicate --otp/--registry)", () => {
  it("Scenario: Given args with --otp value, When stripping, Then both tokens are removed", () => {
    expect(
      stripOverriddenArgs(
        ["--access", "public", "--otp", "123456", "--no-git-checks"],
        ["--otp", "--registry"],
      ),
    ).toEqual(["--access", "public", "--no-git-checks"]);
  });

  it("Scenario: Given args with --otp=value, When stripping, Then the single token is removed", () => {
    expect(
      stripOverriddenArgs(["--access", "public", "--otp=123456"], ["--otp", "--registry"]),
    ).toEqual(["--access", "public"]);
  });

  it("Scenario: Given args with --registry value, When stripping, Then both tokens are removed", () => {
    expect(
      stripOverriddenArgs(
        ["--registry", "https://x.test/", "--tag", "beta"],
        ["--otp", "--registry"],
      ),
    ).toEqual(["--tag", "beta"]);
  });

  it("Scenario: Given args with no overridden flags, When stripping, Then args are unchanged", () => {
    expect(
      stripOverriddenArgs(["--access", "public", "--no-git-checks"], ["--otp", "--registry"]),
    ).toEqual(["--access", "public", "--no-git-checks"]);
  });

  it("Scenario: Given --otp as the last arg with no value, When stripping, Then only the flag is removed", () => {
    expect(stripOverriddenArgs(["--access", "public", "--otp"], ["--otp", "--registry"])).toEqual([
      "--access",
      "public",
    ]);
  });

  it("Scenario: Given multiple --otp occurrences, When stripping, Then all are removed", () => {
    expect(stripOverriddenArgs(["--otp", "1", "--otp=2"], ["--otp", "--registry"])).toEqual([]);
  });

  it("Scenario: Given --otp followed by another flag (--access), When stripping, Then the next flag is preserved", () => {
    // `--otp --access public` — the token after --otp is itself a flag, so it
    // must NOT be swallowed as the otp value.
    expect(stripOverriddenArgs(["--otp", "--access", "public"], ["--otp", "--registry"])).toEqual([
      "--access",
      "public",
    ]);
  });

  it("Scenario: Given an empty args array, When stripping, Then the result is empty", () => {
    expect(stripOverriddenArgs([], ["--otp", "--registry"])).toEqual([]);
  });

  it("Scenario: Given --registry=value form, When stripping, Then it is removed", () => {
    expect(
      stripOverriddenArgs(["--registry=https://x.test/", "--tag", "next"], ["--otp", "--registry"]),
    ).toEqual(["--tag", "next"]);
  });
});

describe("Feature: ensureRecursive flag injection", () => {
  it("Scenario: Given args without -r, When ensuring, Then -r is prepended", () => {
    expect(ensureRecursive(["--no-git-checks"])).toEqual(["-r", "--no-git-checks"]);
  });

  it("Scenario: Given args with -r, When ensuring, Then args are unchanged", () => {
    expect(ensureRecursive(["-r", "--no-git-checks"])).toEqual(["-r", "--no-git-checks"]);
  });

  it("Scenario: Given args with --recursive, When ensuring, Then args are unchanged", () => {
    expect(ensureRecursive(["--recursive", "--filter", "./a"])).toEqual([
      "--recursive",
      "--filter",
      "./a",
    ]);
  });
});

describe("Feature: publisher .npmrc auth merging", () => {
  it("Scenario: Given an empty npmrc, When merging, Then registry + auth lines are appended", () => {
    const result = mergeAuthIntoNpmrc(
      "",
      "https://registry.npmjs.org/",
      "//registry.npmjs.org/",
      "tok",
    );
    expect(result).toBe(
      "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=tok\n",
    );
  });

  it("Scenario: Given a user npmrc with save-exact, When merging, Then the user line is preserved", () => {
    const result = mergeAuthIntoNpmrc("save-exact=true\n", "https://r.test/", "//r.test/", "tok");
    expect(result).toContain("save-exact=true");
    expect(result).toContain("registry=https://r.test/");
    expect(result).toContain("//r.test/:_authToken=tok");
  });

  it("Scenario: Given a user npmrc with a stale authToken + registry, When merging, Then they are replaced (not duplicated)", () => {
    const user = "registry=https://old.test/\n//old.test/:_authToken=stale\nsave-exact=true\n";
    const result = mergeAuthIntoNpmrc(user, "https://new.test/", "//new.test/", "fresh");
    expect(result).not.toContain("old.test");
    expect(result).not.toContain("stale");
    expect(result).toContain("registry=https://new.test/");
    expect(result).toContain("//new.test/:_authToken=fresh");
    expect(result).toContain("save-exact=true");
    expect(result.match(/_authToken=/g)).toHaveLength(1);
    expect(result.match(/^registry=/gm)).toHaveLength(1);
  });

  it("Scenario: Given a npmrc with only blank lines, When merging, Then no leading newlines remain", () => {
    const result = mergeAuthIntoNpmrc("\n\n  \n", "https://r.test/", "//r.test/", "tok");
    expect(result.startsWith("\n")).toBe(false);
    expect(result).toBe("registry=https://r.test/\n//r.test/:_authToken=tok\n");
  });

  it("REGRESSION: the auth line MUST use the colon form <prefix>:_authToken (npm silently drops the no-colon form)", () => {
    // Without the colon, npm/pnpm emit "Unknown project config ..._authToken"
    // and the token never reaches the registry — every publish fails auth.
    const result = mergeAuthIntoNpmrc(
      "",
      "https://registry.npmjs.org/",
      "//registry.npmjs.org/",
      "tok",
    );
    expect(result).toContain("//registry.npmjs.org/:_authToken=tok");
    expect(result).not.toContain("//registry.npmjs.org/_authToken=");
    // Every registry form (custom host, github packages) must keep the colon.
    const gh = mergeAuthIntoNpmrc(
      "",
      "https://npm.pkg.github.com/",
      "//npm.pkg.github.com/",
      "tok",
    );
    expect(gh).toContain("//npm.pkg.github.com/:_authToken=tok");
  });
});

describe("Feature: publisher registry-prefix parsing", () => {
  it("Scenario: Given a registry with trailing slash, When parsing, Then the prefix is canonical", () => {
    expect(registryAuthPrefix("https://registry.npmjs.org/")).toBe("//registry.npmjs.org/");
  });

  it("Scenario: Given a registry without trailing slash, When parsing, Then the prefix still ends with /", () => {
    expect(registryAuthPrefix("https://my.registry.com")).toBe("//my.registry.com/");
  });

  it("Scenario: Given a registry with a path, When parsing, Then the path is kept", () => {
    expect(registryAuthPrefix("https://npm.pkg.github.com/")).toBe("//npm.pkg.github.com/");
  });

  it("Scenario: Given a registry with multiple trailing slashes, When parsing, Then they are collapsed", () => {
    expect(registryAuthPrefix("https://r.test///")).toBe("//r.test/");
  });
});

describe("Feature: parseRecursivePackageList tolerance", () => {
  it("Scenario: Given a well-formed list, When parsing, Then all packages are returned", () => {
    const list = [
      { name: "a", version: "1.0.0", path: "/p/a", private: true },
      { name: "@scope/b", version: "2.0.0", path: "/p/b" },
    ];
    expect(parseRecursivePackageList(list)).toEqual([
      { name: "a", version: "1.0.0", path: "/p/a", private: true },
      { name: "@scope/b", version: "2.0.0", path: "/p/b", private: false },
    ]);
  });

  it("Scenario: Given entries missing required fields, When parsing, Then they are skipped", () => {
    const list = [
      { name: "a", version: "1.0.0", path: "/p/a" },
      { name: "no-version", path: "/p/b" },
      { version: "1.0.0", path: "/p/c" },
      { name: "no-path", version: "1.0.0" },
      null,
      "string-entry",
      42,
    ];
    expect(parseRecursivePackageList(list)).toEqual([
      { name: "a", version: "1.0.0", path: "/p/a", private: false },
    ]);
  });

  it("Scenario: Given an empty array, When parsing, Then an empty array is returned", () => {
    expect(parseRecursivePackageList([])).toEqual([]);
  });

  it("Scenario: Given entries with non-boolean private, When parsing, Then private defaults to false", () => {
    expect(
      parseRecursivePackageList([{ name: "a", version: "1.0.0", path: "/p", private: "yes" }]),
    ).toEqual([{ name: "a", version: "1.0.0", path: "/p", private: false }]);
  });
});

describe("Feature: extractNpmError from pnpm/npm stderr", () => {
  it("Scenario: Given stderr with npm error lines, When extracting, Then the first actionable error is returned (log-path excluded)", () => {
    const stderr = [
      "npm error code E403",
      "npm error 403 Forbidden - PUT https://registry.npmjs.org/pkg - Forbidden",
      "npm error A complete log of this run can be found in: /path/log",
    ].join("\n");
    const extracted = extractNpmError(stderr);
    // The first actionable line is returned; the log-path line is skipped.
    expect(extracted).toBe("code E403");
    expect(extracted).not.toMatch(/log of this run/i);
  });

  it("Scenario: Given stderr with only a log-path line, When extracting, Then that line is used as fallback", () => {
    const stderr = "npm error A complete log of this run can be found in: /path/log";
    expect(extractNpmError(stderr)).toBe("A complete log of this run can be found in: /path/log");
  });

  it("Scenario: Given stderr with only pnpm ERROR lines, When extracting, Then the pnpm error is returned", () => {
    expect(extractNpmError("  ERROR  Something went wrong here")).toBe("Something went wrong here");
  });

  it("Scenario: Given empty stderr, When extracting, Then undefined is returned", () => {
    expect(extractNpmError("")).toBeUndefined();
  });
});

describe("Feature: publish subprocess diagnostics", () => {
  it("Scenario: Given pnpm writes failure text to stdout, When combining diagnostics, Then OTP classification can still see it", () => {
    expect(
      combinePublishDiagnostics("", "npm error code EOTP\nnpm error OTP validation failed"),
    ).toBe("npm error code EOTP\nnpm error OTP validation failed");
  });
});

describe("Feature: withTempNpmrc filesystem lifecycle", () => {
  it("Scenario: Given a directory with no .npmrc, When running, Then a temp .npmrc is created and removed after", async () => {
    const dir = path.join(sandbox, "no-npmrc");
    await fsp.mkdir(dir, { recursive: true });
    const npmrc = path.join(dir, ".npmrc");

    const inner = await withTempNpmrc(dir, "https://r.test/", "tok", async () =>
      fsp.readFile(npmrc, "utf8"),
    );
    expect(inner).toContain("registry=https://r.test/");
    expect(inner).toContain("_authToken=tok");
    // After: file removed.
    await expect(fsp.stat(npmrc)).rejects.toThrow();
  });

  it("Scenario: Given a directory with an existing .npmrc, When running, Then it is restored verbatim after", async () => {
    const dir = path.join(sandbox, "existing-npmrc");
    await fsp.mkdir(dir, { recursive: true });
    const npmrc = path.join(dir, ".npmrc");
    const original = "# user config\nsave-exact=true\n";
    await fsp.writeFile(npmrc, original);

    await withTempNpmrc(dir, "https://r.test/", "tok", async () => {
      // During: the file carries the injected auth.
      const during = await fsp.readFile(npmrc, "utf8");
      expect(during).toContain("_authToken=tok");
    });
    // After: exact original restored, no token leak.
    const after = await fsp.readFile(npmrc, "utf8");
    expect(after).toBe(original);
    expect(after).not.toContain("tok");
  });

  it("Scenario: Given a binary .npmrc (non-utf8), When running, Then the original bytes are restored", async () => {
    const dir = path.join(sandbox, "binary-npmrc");
    await fsp.mkdir(dir, { recursive: true });
    const npmrc = path.join(dir, ".npmrc");
    const original = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x41]);
    await fsp.writeFile(npmrc, original);

    await withTempNpmrc(dir, "https://r.test/", "tok", async () => "ok");
    const after = await fsp.readFile(npmrc);
    expect(Buffer.compare(after, original)).toBe(0);
  });

  it("Scenario: Given fn throws, When running, Then the .npmrc is still restored", async () => {
    const dir = path.join(sandbox, "throw-fn");
    await fsp.mkdir(dir, { recursive: true });
    const npmrc = path.join(dir, ".npmrc");

    await expect(
      withTempNpmrc(dir, "https://r.test/", "tok", async () => {
        throw new Error("publish failed");
      }),
    ).rejects.toThrow("publish failed");
    // No .npmrc existed before → removed on cleanup.
    await expect(fsp.stat(npmrc)).rejects.toThrow();
  });
});

describe("Feature: PnpmNotOnPathError", () => {
  it("Scenario: Given no message, When constructing, Then a default message is used", () => {
    const err = new PnpmNotOnPathError();
    expect(err.message).toBe("pnpm is not available on PATH.");
    expect(err.name).toBe("PnpmNotOnPathError");
  });

  it("Scenario: Given a custom message, When constructing, Then it is preserved", () => {
    const err = new PnpmNotOnPathError("custom");
    expect(err.message).toBe("custom");
    expect(err).toBeInstanceOf(Error);
  });
});
