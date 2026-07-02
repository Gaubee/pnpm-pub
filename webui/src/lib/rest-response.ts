/**
 * REST response parsers — the frontend's deserialization boundary for daemon
 * REST (`/api/*`) responses. Each parser delegates to a Zod schema via
 * `safeParse`, returning null on validation failure (mirrors the old hand-
 * written validators but with full structural coverage).
 */
import { z } from 'zod';
import { TrustedPublisherConfigSchema } from '$shared/schemas.js';
import type { TrustedPublisherConfig, NpmPackage, PackageDetail, ProfileDetail } from './types.js';

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

const NpmPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().nullable().optional(),
  repository: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  keywords: z.array(z.string()).optional(),
  score: z.number().optional(),
});

const PackagesResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(NpmPackageSchema).optional(),
  total: z.number().optional(),
  page: z.number().optional(),
  pageSize: z.number().optional(),
  error: z.string().optional(),
});

const ProfileTokenResponseSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
  error: z.string().optional(),
});

const ProfilePasswordResponseSchema = z.object({
  ok: z.boolean(),
  password: z.string().optional(),
  error: z.string().optional(),
});

const ProfileDetailResponseSchema = z.object({
  ok: z.boolean(),
  detail: z
    .object({
      name: z.string().nullable(),
      fullname: z.string().nullable(),
      email: z.string().nullable(),
      emailVerified: z.boolean().nullable(),
      github: z.string().nullable(),
      twitter: z.string().nullable(),
      homepage: z.string().nullable(),
      tfaEnabled: z.boolean().nullable(),
      createdAt: z.string().nullable(),
    })
    .optional(),
  // Present (true) when the daemon's liveness probe found the token invalid —
  // the WebUI should offer re-auth instead of retrying blindly.
  needsReauth: z.boolean().optional(),
  error: z.string().optional(),
});

const PackageDetailResponseSchema = z.object({
  ok: z.boolean(),
  detail: z
    .object({
      name: z.string(),
      version: z.string(),
      description: z.string().nullable(),
      readme: z.string(),
      license: z.string().nullable(),
      repository: z.string().nullable(),
      homepage: z.string().nullable(),
      lastPublish: z.string().nullable(),
      modified: z.string().nullable(),
      keywords: z.array(z.string()),
      collaborators: z.array(
        z.object({
          username: z.string(),
          access: z.string().optional(),
          email: z.string().optional(),
        }),
      ),
      weeklyDownloads: z.number(),
    })
    .optional(),
  needsReauth: z.boolean().optional(),
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
export type NpmPackageResponse = { ok: boolean; items?: NpmPackage[]; total?: number; page?: number; pageSize?: number; error?: string };
export type ProfileTokenResponse = z.infer<typeof ProfileTokenResponseSchema>;
export type ProfilePasswordResponse = z.infer<typeof ProfilePasswordResponseSchema>;
export type ProfileDetailResponse = { ok: boolean; detail?: ProfileDetail; needsReauth?: boolean; error?: string };
export type PackageDetailResponse = { ok: boolean; detail?: PackageDetail; needsReauth?: boolean; error?: string };

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

export function parsePackagesResponse(value: unknown): NpmPackageResponse | null {
	return safeOrNull(PackagesResponseSchema, value);
}

export function parseProfileTokenResponse(value: unknown): ProfileTokenResponse | null {
  return safeOrNull(ProfileTokenResponseSchema, value);
}

export function parseProfilePasswordResponse(value: unknown): ProfilePasswordResponse | null {
  return safeOrNull(ProfilePasswordResponseSchema, value);
}

export function parseProfileDetailResponse(value: unknown): ProfileDetailResponse | null {
	return safeOrNull(ProfileDetailResponseSchema, value);
}

export function parsePackageDetailResponse(value: unknown): PackageDetailResponse | null {
	return safeOrNull(PackageDetailResponseSchema, value);
}

/** Run safeParse; return the data on success, null on failure. */
function safeOrNull<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}
