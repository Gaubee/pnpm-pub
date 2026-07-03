/**
 * WS message parser — the frontend's deserialization boundary for daemon WS
 * frames. Replaces ~150 lines of hand-written is* validators with a single
 * Zod safeParse against the shared WsServerMessageSchema.
 *
 * The schema is defined in src/shared/schemas.ts (single source of truth)
 * and imported via relative path (webui can't import from src/shared/index
 * because it contains Node-only code, but schemas.ts is pure Zod).
 */
import { WsServerMessageSchema } from "$shared/schemas.js";
import type { WsServerMessage } from "./types.js";

/**
 * Parse a raw WS frame (string or object) into a typed WsServerMessage.
 * Returns null when the frame is not valid JSON or doesn't match the schema.
 */
export function parseWsServerMessage(data: unknown): WsServerMessage | null {
  // The daemon sends text frames; parse JSON first if needed.
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const result = WsServerMessageSchema.safeParse(value);
  return result.success ? (result.data as WsServerMessage) : null;
}
