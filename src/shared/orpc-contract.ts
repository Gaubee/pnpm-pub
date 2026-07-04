/**
 * WebUI oRPC contract.
 *
 * This is the transport contract between the local daemon and the tray-hosted
 * WebUI. It is browser-safe: only Zod schemas and pure oRPC contract builders
 * are imported here.
 */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  BackupBundleSchema,
  PackageDetailSchema,
  PubEventSchema,
  TrustedPublisherConfigSchema,
  WsServerMessageSchema,
} from "./schemas.js";

const OkResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

const TokenApplyResponseSchema = z.object({
  ok: z.boolean(),
  needsManualToken: z.boolean().optional(),
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
      source: z.enum(["authenticated-profile", "registry-profile", "maintainer-gravatar", "none"]),
    })
    .optional(),
});

const ProfileSecretResponseSchema = z.object({
  ok: z.boolean(),
  token: z.string().optional(),
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
  needsReauth: z.boolean().optional(),
  error: z.string().optional(),
});

const ExportResponseSchema = z.object({
  ok: z.boolean(),
  bundle: z.unknown().optional(),
  skipped: z.array(z.string()).optional(),
  error: z.string().optional(),
});

const ImportResponseSchema = z.object({
  ok: z.boolean(),
  imported: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const NpmPackageSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  repository: z.string().nullable(),
  date: z.string().nullable(),
  scope: z.string().nullable(),
  keywords: z.array(z.string()),
  score: z.number(),
});
export type NpmPackageDto = z.infer<typeof NpmPackageSchema>;

export const PackagesQuerySchema = z.object({
  q: z.string().default(""),
  sort: z.enum(["date", "name"]).default("date"),
  page: z.number().int().nonnegative().default(0),
  pageSize: z.number().int().positive().default(25),
});
export type PackagesQuery = z.infer<typeof PackagesQuerySchema>;

export const PackagesListFrameSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    source: z.enum(["local", "registry"]),
    items: z.array(NpmPackageSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
    updatedAt: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    source: z.literal("registry"),
    status: z.number().int().positive(),
    error: z.string(),
  }),
]);
export type PackagesListFrame = z.infer<typeof PackagesListFrameSchema>;

const PackageDetailResponseSchema = z.object({
  ok: z.boolean(),
  detail: PackageDetailSchema.optional(),
  needsReauth: z.boolean().optional(),
  error: z.string().optional(),
});

const EventsQuerySchema = z.object({
  scope: z.enum(["pending", "history"]).default("history"),
  name: z.string().optional(),
  q: z.string().default(""),
  group: z.string().optional(),
  page: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(100).default(20),
});

const EventsQueryResponseSchema = z.object({
  rows: z.array(PubEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

const RepoInfoSchema = z
  .object({
    host: z.string(),
    shortName: z.string(),
    slug: z.string(),
    browseUrl: z.string(),
    faviconUrl: z.string(),
    brand: z.enum(["github", "gitlab", "gitee", "bitbucket", "codeberg", "gitcode"]).nullable(),
  })
  .nullable();

const RepoInfoResponseSchema = z.object({
  ok: z.boolean(),
  info: RepoInfoSchema.optional(),
  error: z.string().optional(),
});

const TrustListResponseSchema = z.object({
  ok: z.boolean(),
  configs: z.array(TrustedPublisherConfigSchema).optional(),
  needsReauth: z.boolean().optional(),
  error: z.string().optional(),
});

export const TrustedPublisherCreateConfigSchema = z.discriminatedUnion("type", [
  TrustedPublisherConfigSchema.options[0].omit({ id: true }),
  TrustedPublisherConfigSchema.options[1].omit({ id: true }),
  TrustedPublisherConfigSchema.options[2].omit({ id: true }),
]);
export type TrustedPublisherCreateConfig = z.infer<typeof TrustedPublisherCreateConfigSchema>;

const ScanWorkspaceResponseSchema = z.object({
  messages: z.array(WsServerMessageSchema),
});

export const webRpcContract = {
  state: {
    subscribe: oc.output(eventIterator(WsServerMessageSchema)),
  },
  profile: {
    select: oc.input(z.object({ username: z.string().min(1) })).output(OkResponseSchema),
    lookupNpm: oc
      .input(z.object({ username: z.string().min(1), registry: z.string().optional() }))
      .output(NpmProfileLookupResponseSchema),
    token: oc.input(z.object({ username: z.string().min(1) })).output(ProfileSecretResponseSchema),
    password: oc
      .input(z.object({ username: z.string().min(1) }))
      .output(ProfileSecretResponseSchema),
    detail: oc.output(ProfileDetailResponseSchema),
    add: oc
      .input(
        z.object({
          username: z.string().min(1),
          password: z.string().min(1),
          totpSecret: z.string().min(1),
          registry: z.string().optional(),
          manualToken: z.string().optional(),
        }),
      )
      .output(TokenApplyResponseSchema),
    renew: oc
      .input(
        z.object({
          username: z.string().min(1),
          password: z.string().optional(),
          registry: z.string().optional(),
          manualToken: z.string().optional(),
          totpSecret: z.string().optional(),
        }),
      )
      .output(TokenApplyResponseSchema),
    setAutoRenew: oc
      .input(z.object({ username: z.string().min(1), autoRenew: z.boolean() }))
      .output(OkResponseSchema),
    delete: oc.input(z.object({ username: z.string().min(1) })).output(OkResponseSchema),
  },
  backup: {
    export: oc.input(z.object({ password: z.string().min(1) })).output(ExportResponseSchema),
    import: oc
      .input(
        z.object({
          bundle: BackupBundleSchema,
          password: z.string().min(1),
          usernames: z.array(z.string().min(1)),
        }),
      )
      .output(ImportResponseSchema),
  },
  packages: {
    list: oc.input(PackagesQuerySchema).output(eventIterator(PackagesListFrameSchema)),
    detail: oc.input(z.object({ name: z.string().min(1) })).output(PackageDetailResponseSchema),
  },
  events: {
    query: oc.input(EventsQuerySchema).output(EventsQueryResponseSchema),
    confirm: oc.input(z.object({ id: z.string().min(1) })).output(OkResponseSchema),
    reject: oc.input(z.object({ id: z.string().min(1) })).output(OkResponseSchema),
    update: oc
      .input(z.object({ id: z.string().min(1), args: z.array(z.string()) }))
      .output(OkResponseSchema),
    create: oc
      .input(
        z.object({
          kind: z.enum([
            "publish",
            "setup-oidc",
            "create-placeholder",
            "refresh-token",
            "unpublish",
            "recursive-publish",
          ]),
          payload: z.unknown(),
          groupId: z.string().optional(),
        }),
      )
      .output(ScanWorkspaceResponseSchema),
  },
  workspace: {
    scan: oc.input(z.object({ root: z.string().min(1) })).output(ScanWorkspaceResponseSchema),
    pin: oc
      .input(z.object({ path: z.string().min(1), pinned: z.boolean() }))
      .output(OkResponseSchema),
    remove: oc.input(z.object({ path: z.string().min(1) })).output(OkResponseSchema),
    confirmRisky: oc.input(z.object({ token: z.string().min(1) })).output(OkResponseSchema),
    cancelRisky: oc.input(z.object({ token: z.string().min(1) })).output(OkResponseSchema),
  },
  repo: {
    info: oc.input(z.object({ repo: z.string().min(1) })).output(RepoInfoResponseSchema),
    openPath: oc.input(z.object({ path: z.string().min(1) })).output(OkResponseSchema),
    openUrl: oc.input(z.object({ url: z.string().min(1) })).output(OkResponseSchema),
  },
  oidc: {
    listTrust: oc.input(z.object({ package: z.string().min(1) })).output(TrustListResponseSchema),
    addTrust: oc
      .input(z.object({ package: z.string().min(1), config: TrustedPublisherCreateConfigSchema }))
      .output(OkResponseSchema),
    removeTrust: oc
      .input(z.object({ package: z.string().min(1), uuid: z.string().min(1) }))
      .output(OkResponseSchema),
  },
  tray: {
    setPin: oc.input(z.object({ pinned: z.boolean() })).output(OkResponseSchema),
    completeAutoClose: oc.output(OkResponseSchema),
    windowHidden: oc.output(OkResponseSchema),
  },
} as const;

export type WebRpcContract = typeof webRpcContract;
