/**
 * REST response parsers — the frontend's deserialization boundary for daemon
 * REST (`/api/*`) responses. Each parser delegates to a Zod schema via
 * `safeParse`, returning null on validation failure (mirrors the old hand-
 * written validators but with full structural coverage).
 */
import { z } from 'zod';
import { TrustedPublisherConfigSchema } from '$shared/schemas.js';
import type { TrustedPublisherConfig } from './types.js';

// ---------------------------------------------------------------------------
// Response schemas (passthrough for forward-compat with new daemon fields)
// ---------------------------------------------------------------------------

const TokenApplyResponseSchema = z.object({
  ok: z.boolean(),
  needsManualToken: z.boolean().optional(),
  error: z.string().optional(),
});

const ExportResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  // bundle is untyped opaque JSON; accept anything when present.
  bundle: z.unknown().optional(),
});

const ImportResponseSchema = z.object({
  ok: z.boolean(),
  imported: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const OkResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const NpmProfileLookupResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  profile: z
    .object({
      username: z.string(),
      registry: z.string(),
      avatarUrl: z.string().nullable(),
      source: z.enum(['authenticated-profile', 'registry-profile', 'maintainer-gravatar', 'none']),
    })
    .optional(),
});

const TrustListResponseSchema = z.object({
  ok: z.boolean(),
  configs: z.array(TrustedPublisherConfigSchema).optional(),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Derived types (re-exported for callers)
// ---------------------------------------------------------------------------

export type TokenApplyResponse = z.infer<typeof TokenApplyResponseSchema>;
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type OkResponse = z.infer<typeof OkResponseSchema>;
export type NpmProfileLookupResponse = z.infer<typeof NpmProfileLookupResponseSchema>;
export type TrustListResponse = { ok: boolean; configs?: TrustedPublisherConfig[]; error?: string };

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseTokenApplyResponse(value: unknown): TokenApplyResponse | null {
  return safeOrNull(TokenApplyResponseSchema, value);
}

export function parseExportResponse(value: unknown): ExportResponse | null {
  return safeOrNull(ExportResponseSchema, value);
}

export function parseImportResponse(value: unknown): ImportResponse | null {
  return safeOrNull(ImportResponseSchema, value);
}

export function parseOkResponse(value: unknown): OkResponse | null {
  return safeOrNull(OkResponseSchema, value);
}

export function parseNpmProfileLookupResponse(value: unknown): NpmProfileLookupResponse | null {
  return safeOrNull(NpmProfileLookupResponseSchema, value);
}

export function parseTrustListResponse(value: unknown): TrustListResponse | null {
  return safeOrNull(TrustListResponseSchema, value);
}

/** Run safeParse; return the data on success, null on failure. */
function safeOrNull<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
