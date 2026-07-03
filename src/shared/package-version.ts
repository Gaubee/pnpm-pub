import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);

/** Read the current pnpm-pub package version used for CLI/daemon handshakes. */
export function readPackageVersion(): string {
  return readPackageVersionFrom(path.dirname(thisFile));
}

/** Resolve and read pnpm-pub package metadata from a caller-provided start directory. */
export function readPackageVersionFrom(startDir: string): string {
  const pkgPath = findPackageJson(startDir);
  if (!pkgPath) {
    throw new Error("Unable to locate pnpm-pub package.json for version handshake.");
  }
  const manifest = parsePackageManifest(readJsonFile(pkgPath));
  if (!manifest || manifest.name !== "pnpm-pub" || manifest.version.length === 0) {
    throw new Error(`Invalid pnpm-pub package metadata at ${pkgPath}.`);
  }
  return manifest.version;
}

function findPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, "package.json");
    try {
      const manifest = parsePackageManifest(readJsonFile(candidate));
      if (manifest?.name === "pnpm-pub") return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parsePackageManifest(value: unknown): { name?: string; version: string } | null {
  if (!isRecord(value)) return null;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    version: typeof value.version === "string" ? value.version : "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
