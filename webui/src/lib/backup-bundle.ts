import { BackupBundleSchema } from "$shared/schemas.js";
import type { BackupBundle } from "./types.js";

export type BackupBundleParseResult =
  | { ok: true; bundle: BackupBundle }
  | { ok: false; reason: "invalid-json" | "invalid-shape" };

export function parseBackupBundleJson(text: string): BackupBundleParseResult {
  try {
    const parsed: unknown = JSON.parse(text);
    const result = BackupBundleSchema.safeParse(parsed);
    return result.success
      ? { ok: true, bundle: result.data }
      : { ok: false, reason: "invalid-shape" };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}
