import { readFileSync } from "node:fs";

const packageManifestUrl = new URL("../../package.json", import.meta.url);

export function readExpectedPackageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(packageManifestUrl, "utf8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("Invalid test package manifest version.");
  }
  return parsed.version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
