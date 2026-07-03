import type { PublishConfig } from "../shared/index.js";

/** Decode package.json publishConfig values that affect the daemon publish write. */
export function parsePackagePublishConfig(value: unknown): PublishConfig | undefined {
  if (!isRecord(value)) return undefined;
  const registry = readString(value, "registry");
  const tag = readString(value, "tag");
  const access = readString(value, "access");
  if (!registry && !tag && !access) return undefined;
  return {
    ...(registry ? { registry } : {}),
    ...(tag ? { tag } : {}),
    ...(access ? { access } : {}),
  };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
