/**
 * CLI package-bin contract regressions (Chapter 7 / npm bin).
 */
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { isCliEntrypointInvocation } from "../../src/cli/cli.js";

const root = new URL("../../", import.meta.url);
const packageManifestUrl = new URL("package.json", root);
const cliSourceUrl = new URL("src/cli/cli.ts", root);

describe("CLI package-bin contract", () => {
  it("Scenario: Given the package bin manifest, When pnpm-pub is installed globally, Then the bin target is the release CLI", () => {
    const manifest = readJsonRecord(packageManifestUrl);

    expect(manifest.bin).toEqual({ "pnpm-pub": "./dist/cli.js" });
  });

  it("Scenario: Given the CLI source entry, When it is bundled for npm bin usage, Then it carries a Node shebang", () => {
    const source = readFileSync(cliSourceUrl, "utf8");

    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("Scenario: Given npm links the bin through a symlink, When Node starts the target, Then the CLI still detects direct execution", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "pnpm-pub-bin-"));
    const realEntry = path.join(rootDir, "dist", "cli.js");
    const linkedEntry = path.join(rootDir, "bin", "pnpm-pub");
    await mkdir(path.dirname(realEntry), { recursive: true });
    await mkdir(path.dirname(linkedEntry), { recursive: true });
    await writeFile(realEntry, "#!/usr/bin/env node\n", "utf8");
    await symlink(realEntry, linkedEntry);

    expect(isCliEntrypointInvocation(linkedEntry, pathToFileURL(realEntry).href)).toBe(true);
  });
});

function readJsonRecord(url: URL): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(url, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object: ${url.pathname}`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
