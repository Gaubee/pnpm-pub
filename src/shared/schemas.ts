/**
 * Zod schemas — the single source of truth for every type that crosses a
 * serialization boundary (config files, oRPC/WebSocket frames,
 * keychain items, backup bundles, npm API responses).
 *
 * Types are derived via `z.infer<typeof Schema>` and re-exported from
 * `src/shared/index.ts`. Daemon and webui both import from here. No Node-only
 * APIs are used — pure Zod + pure types, safe for browser bundling.
 *
 * Convention:
 *   - Config files (profiles.json, workspaces.json): `.strict()` — reject
 *     unknown fields so a typo doesn't silently create a broken profile.
 *   - oRPC/WebSocket protocol: `.passthrough()` — forward-compatible so a newer
 *     daemon adding a field doesn't break an older webui.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config: profiles.json
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  username: z.string().min(1),
  registry: z.string().optional(),
  avatarUrl: z.string().optional(),
  ciPreferences: z.record(z.string(), z.unknown()).optional(),
  authStatus: z.enum(["authenticated", "unauthenticated"]).optional(),
  /**
   * Whether the daemon should automatically re-mint the NPM token (using the
   * stored password) before it expires. Off requires the user to renew manually.
   */
  autoRenew: z.boolean().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PnpmPubConfigSchema = z.object({
  default: z.string(),
  profiles: z.array(ProfileSchema),
});
export type PnpmPubConfig = z.infer<typeof PnpmPubConfigSchema>;

// ---------------------------------------------------------------------------
// Config: workspaces.json
// ---------------------------------------------------------------------------

export const WorkspaceEntrySchema = z.object({
  path: z.string().min(1),
  pinned: z.boolean(),
  addedAt: z.number().int().nonnegative(),
});
export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;

export const WorkspacesConfigSchema = z.object({
  paths: z.array(WorkspaceEntrySchema),
});
export type WorkspacesConfig = z.infer<typeof WorkspacesConfigSchema>;

// ---------------------------------------------------------------------------
// Config: preferences.json — app-wide UI preferences (Chapter 6.4).
//
// Unlike profiles/workspaces this schema is NOT `.strict()`: it uses default
// strip parsing so a future field added by a newer daemon doesn't reject an
// older reader, and a missing file yields the defaults below. The only field
// today is `keepOnTop` — whether the tray window stays pinned on top and
// exempt from blur auto-hide.
//
// ⚠️ MAINTAINER NOTE: when you add a field here you MUST:
//   1. Add it to `DEFAULT_PREFERENCES`.
//   2. Add a matching control in the WebUI SettingsDialog 「偏好 / Preferences」
//      tab (`webui/src/lib/components/settings/preferences-tab.svelte`). Every
//      persisted preference must be user-editable from that tab — preferences is
//      the single read/write source, so an unexposed field would be unchangeable.
// ---------------------------------------------------------------------------

export const PreferencesSchema = z.object({
  keepOnTop: z.boolean(),
  values: z.record(z.string(), z.unknown()).default({}),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = { keepOnTop: false, values: {} };

// ---------------------------------------------------------------------------
// Backup bundle (Chapter 8.2)
// ---------------------------------------------------------------------------

export const BackupBundleSchema = z.object({
  profiles: z.array(z.string().min(1)).min(1),
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});
export type BackupBundle = z.infer<typeof BackupBundleSchema>;

// ---------------------------------------------------------------------------
// IPC protocol (CLI <-> Daemon)
// ---------------------------------------------------------------------------

export const ManagementCommandSchema = z.enum(["start", "status", "stop"]);
export type ManagementCommand = z.infer<typeof ManagementCommandSchema>;

export const IpcHandshakeSchema = z.object({
  cliVersion: z.string(),
});
export type IpcHandshake = z.infer<typeof IpcHandshakeSchema>;

export const IpcPublishRequestSchema = z.object({
  command: z.literal("publish"),
  cwd: z.string(),
  args: z.array(z.string()),
  profileOverride: z.string().optional(),
});
export type IpcPublishRequest = z.infer<typeof IpcPublishRequestSchema>;

export const IpcManagementRequestSchema = z.object({
  command: ManagementCommandSchema,
  profileOverride: z.string().optional(),
});
export type IpcManagementRequest = z.infer<typeof IpcManagementRequestSchema>;

export const IpcLogFrameSchema = z.object({
  type: z.enum(["stdout", "stderr"]),
  data: z.string(),
});
export type IpcLogFrame = z.infer<typeof IpcLogFrameSchema>;

export const IpcExitFrameSchema = z.object({
  type: z.literal("exit"),
  code: z.number(),
  message: z.string().optional(),
});
export type IpcExitFrame = z.infer<typeof IpcExitFrameSchema>;

export const IpcStatusFrameSchema = z.object({
  type: z.literal("status"),
  active: z.boolean(),
  profile: z.string().optional(),
  pid: z.number().optional(),
});
export type IpcStatusFrame = z.infer<typeof IpcStatusFrameSchema>;

/** Union of all IPC frames (daemon → CLI). */
export type IpcFrame = IpcLogFrame | IpcExitFrame | IpcStatusFrame;

/** Union of all IPC requests (CLI → daemon). */
export type IpcRequest = IpcHandshake | IpcPublishRequest | IpcManagementRequest;

// ---------------------------------------------------------------------------
// Events hub
// ---------------------------------------------------------------------------

export const EventKindSchema = z.enum([
  "publish",
  "configure-trust",
  "create-placeholder",
  "refresh-token",
  "unpublish",
  "recursive-publish",
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EventStatusSchema = z.enum([
  "pending",
  "success",
  "failed",
  "expired",
  "action-required",
  "rejected",
  // trusted-publishing pre-flight outcome (Chapter 6.2.7): the desired config
  // already matched the registry's current config; no HTTP write was needed.
  // NOTE: "conflict" is NOT a final status — it is only a transient webui
  // pre-flight *display label*. A conflicting config is auto-resolved by the
  // daemon via delete-then-put and lands as success (or failed on error).
  "skipped",
]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

export const PublishConfigSchema = z.object({
  registry: z.string().optional(),
  tag: z.string().optional(),
  access: z.string().optional(),
});
export type PublishConfig = z.infer<typeof PublishConfigSchema>;

export const PublishTargetSchema = z.object({
  name: z.string(),
  version: z.string(),
  previousVersion: z.string().optional(),
  description: z.string().optional(),
  path: z.string(),
  repository: z.string().optional(),
  publishConfig: PublishConfigSchema.optional(),
  publishable: z.boolean().optional(),
});
export type PublishTarget = z.infer<typeof PublishTargetSchema>;

export const PublishSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory"), path: z.string() }),
  z.object({ kind: z.literal("tarball"), path: z.string() }),
]);
export type PublishSource = z.infer<typeof PublishSourceSchema>;

export const PublishContextSchema = z.object({
  source: PublishSourceSchema,
  args: z.array(z.string()),
  target: PublishTargetSchema,
  /** Current git branch of the publish source (daemon-filled hint for the
   *  publish-branch option). Empty/absent when not a git repo or git missing —
   *  the scheduler's own preflight is the authoritative gate, not this value. */
  branch: z.string().optional(),
});
export type PublishContext = z.infer<typeof PublishContextSchema>;

export const CreatePlaceholderContextSchema = z.object({
  name: z.string(),
});
export type CreatePlaceholderContext = z.infer<typeof CreatePlaceholderContextSchema>;

export const RefreshTokenContextSchema = z.object({
  username: z.string(),
});
export type RefreshTokenContext = z.infer<typeof RefreshTokenContextSchema>;

export const UnpublishContextSchema = z.object({
  /** Fully-qualified package name (`@scope/name` or `name`). */
  name: z.string(),
  /** The version to remove. */
  version: z.string(),
});
export type UnpublishContext = z.infer<typeof UnpublishContextSchema>;

/**
 * Recursive publish context — a workspace-level publish driven by
 * `pnpm publish -r`. Distinct from the single-package `publish` event because
 * it carries multiple targets and REQUIRES pnpm (no API fallback). The targets
 * are enumerated up-front via `pnpm pack -r` so the WebUI can show what will be
 * published before the user confirms.
 */
export const RecursivePublishContextSchema = z.object({
  /** Workspace root directory (the cwd for `pnpm publish -r`). */
  source: PublishSourceSchema,
  /** Shared publish argv (--access/--tag/--no-git-checks/etc). */
  args: z.array(z.string()),
  /** The packages that will be published, enumerated via `pnpm pack -r`. */
  targets: z.array(PublishTargetSchema),
  branch: z.string().optional(),
});
export type RecursivePublishContext = z.infer<typeof RecursivePublishContextSchema>;

// ---------------------------------------------------------------------------
// Tarball file-tree summary — cached on publish events so the WebUI can
// preview the packed contents without re-packing.
// ---------------------------------------------------------------------------

export const TarballFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  mode: z.number().int().nonnegative(),
});
export type TarballFile = z.infer<typeof TarballFileSchema>;

export const TarballSummarySchema = z.object({
  files: z.array(TarballFileSchema),
  unpackedSize: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  bundled: z.array(z.string()),
});
export type TarballSummary = z.infer<typeof TarballSummarySchema>;

// ---------------------------------------------------------------------------
// Trusted Publishing — npm /trust API
// ---------------------------------------------------------------------------

export const TrustedPublisherTypeSchema = z.enum(["github", "circleci", "gitlab"]);
export type TrustedPublisherType = z.infer<typeof TrustedPublisherTypeSchema>;

export const TrustedPublisherPermissionSchema = z.enum(["createPackage", "createStagedPackage"]);
export type TrustedPublisherPermission = z.infer<typeof TrustedPublisherPermissionSchema>;

const TrustedPublisherBaseSchema = z.object({
  id: z.string().optional(),
  permissions: z
    .array(TrustedPublisherPermissionSchema)
    .default(["createPackage", "createStagedPackage"]),
});

// Field names mirror the npm registry wire format (what safe-npm-sdk sends
// and what GET returns), NOT the human-friendly names on npm's HTML form. The
// form layer splits these into separate inputs and
// reassembles them in buildConfig().
export const GithubActionsPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal("github"),
  claims: z.object({
    repository: z.string(),
    workflow_ref: z.object({ file: z.string() }),
    environment: z.string().optional(),
  }),
});
export type GithubActionsPublisher = z.infer<typeof GithubActionsPublisherSchema>;

export const CircleCiPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal("circleci"),
  claims: z.object({
    "oidc.circleci.com/org-id": z.string(),
    "oidc.circleci.com/project-id": z.string(),
    "oidc.circleci.com/pipeline-definition-id": z.string(),
    "oidc.circleci.com/context-ids": z.array(z.string()).optional(),
    "oidc.circleci.com/vcs-origin": z.string(),
  }),
});
export type CircleCiPublisher = z.infer<typeof CircleCiPublisherSchema>;

export const GitlabCiPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal("gitlab"),
  claims: z.object({
    project_path: z.string(),
    ci_config_ref_uri: z.string().optional(),
    environment: z.string().optional(),
  }),
});
export type GitlabCiPublisher = z.infer<typeof GitlabCiPublisherSchema>;

export const TrustedPublisherConfigSchema = z.discriminatedUnion("type", [
  GithubActionsPublisherSchema,
  CircleCiPublisherSchema,
  GitlabCiPublisherSchema,
]);
export type TrustedPublisherConfig = z.infer<typeof TrustedPublisherConfigSchema>;

export const TrustedPublisherCreateConfigSchema = z.discriminatedUnion("type", [
  GithubActionsPublisherSchema.omit({ id: true }),
  CircleCiPublisherSchema.omit({ id: true }),
  GitlabCiPublisherSchema.omit({ id: true }),
]);
export type TrustedPublisherCreateConfig = z.infer<typeof TrustedPublisherCreateConfigSchema>;

export const TrustedPublishingOperationSchema = z.enum(["add", "update", "remove"]);
export type TrustedPublishingOperation = z.infer<typeof TrustedPublishingOperationSchema>;

export const TrustedPublishingTargetSchema = z.object({
  name: z.string().min(1),
  path: z.string().optional(),
  repository: z.string().optional(),
  currentConfig: TrustedPublisherConfigSchema.optional(),
});
export type TrustedPublishingTarget = z.infer<typeof TrustedPublishingTargetSchema>;

export const ConfigureTrustContextSchema = z.object({
  action: TrustedPublishingOperationSchema,
  target: TrustedPublishingTargetSchema,
  config: TrustedPublisherCreateConfigSchema.optional(),
});
export type ConfigureTrustContext = z.infer<typeof ConfigureTrustContextSchema>;

export const EventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("publish"), data: PublishContextSchema }),
  z.object({ kind: z.literal("configure-trust"), data: ConfigureTrustContextSchema }),
  z.object({ kind: z.literal("create-placeholder"), data: CreatePlaceholderContextSchema }),
  z.object({ kind: z.literal("refresh-token"), data: RefreshTokenContextSchema }),
  z.object({ kind: z.literal("unpublish"), data: UnpublishContextSchema }),
  z.object({ kind: z.literal("recursive-publish"), data: RecursivePublishContextSchema }),
]);
export type EventPayload = z.infer<typeof EventPayloadSchema>;

export type EventPayloadData<K extends EventKind> = Extract<EventPayload, { kind: K }>["data"];

export const PubEventSchema = z.object({
  id: z.string(),
  kind: EventKindSchema,
  status: EventStatusSchema,
  profile: z.string(),
  profileOverride: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().optional(),
  payload: EventPayloadSchema.optional(),
  result: z.string().optional(),
  clockDriftRecovered: z.boolean().optional(),
  /** Batch correlation id — events sharing a groupId were created together. */
  groupId: z.string().optional(),
  /** Packed-tarball file list, cached when the publish runs (dry or real). */
  tarballSummary: TarballSummarySchema.optional(),
  /** Per-target tarball summaries for a recursive publish (one per target). */
  tarballSummaries: z
    .array(z.object({ name: z.string(), version: z.string(), summary: TarballSummarySchema }))
    .optional(),
});
export type PubEvent = z.infer<typeof PubEventSchema>;

export const HistoryEventGroupSchema = z.object({
  id: z.string(),
  events: z.array(PubEventSchema).min(1),
});
export type HistoryEventGroup = z.infer<typeof HistoryEventGroupSchema>;

export const HistoryEventGroupPageSchema = z.object({
  groups: z.array(HistoryEventGroupSchema),
  totalGroups: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type HistoryEventGroupPage = z.infer<typeof HistoryEventGroupPageSchema>;

// ---------------------------------------------------------------------------
// Package detail (PackageDetail page) — projection of a registry packument.
// ---------------------------------------------------------------------------

export const PackageCollaboratorSchema = z
  .object({
    username: z.string(),
    access: z.string().optional(),
    email: z.string().optional(),
  })
  .passthrough();
export type PackageCollaborator = z.infer<typeof PackageCollaboratorSchema>;

export const PackageDetailSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    description: z.string().nullable(),
    readme: z.string(),
    license: z.string().nullable(),
    repository: z.string().nullable(),
    homepage: z.string().nullable(),
    /** ISO-8601 publish time of the latest dist-tag version, if known. */
    lastPublish: z.string().nullable(),
    /** ISO-8601 of the most recent packument modification, if known. */
    modified: z.string().nullable(),
    keywords: z.array(z.string()),
    collaborators: z.array(PackageCollaboratorSchema),
    weeklyDownloads: z.number().int().nonnegative(),
  })
  .passthrough();
export type PackageDetail = z.infer<typeof PackageDetailSchema>;

export const PackageDetailResponseSchema = z.object({
  ok: z.literal(true),
  detail: PackageDetailSchema,
});
export type PackageDetailResponse = z.infer<typeof PackageDetailResponseSchema>;

// ---------------------------------------------------------------------------
// WS protocol
// ---------------------------------------------------------------------------

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), webTokenRequired: z.literal(true) }),
  z.object({ type: z.literal("events"), events: z.array(PubEventSchema) }),
  z.object({ type: z.literal("event"), event: PubEventSchema }),
  /**
   * Trusted-publishing group draft state. Single lightweight frame per change
   * (NOT a per-member echo) — carries the group's shared default config and the
   * explicit set of member ids that inherit it. Sent on connect (once per
   * pending group) and whenever the default form edits the group draft or a
   * member's inherit/custom flag flips.
   */
  z.object({
    type: z.literal("group-trust-draft"),
    groupId: z.string(),
    defaultConfig: TrustedPublisherCreateConfigSchema.optional(),
    inheritMembers: z.array(z.string()),
  }),
  z.object({ type: z.literal("profiles"), default: z.string(), profiles: z.array(ProfileSchema) }),
  z.object({ type: z.literal("workspaces"), workspaces: z.array(WorkspaceEntrySchema) }),
  /**
   * Tray/window state projection. Sent on connect and whenever TrayHost facts
   * change. `exitRequested` is the daemon's authorization for the page-owned
   * opacity timeline; the WebUI derives the visible 5→0 countdown from WAAPI.
   * NOTE: the "keep open" pin (`pinned`) is NOT part of this frame — it is a
   * persisted preference and travels via the `preferences` frame below.
   */
  z.object({
    type: z.literal("pin"),
    exitRequested: z.boolean(),
    visibility: z.enum(["hidden", "shown"]),
    hasActiveEvents: z.boolean(),
  }),
  /**
   * App-wide preferences snapshot (Chapter 6.4). Sent on connect and whenever
   * preferences change (single read/write source for the keep-open pin and any
   * future preference field). The WebUI derives `pinned` from `keepOnTop`.
   */
  z.object({
    type: z.literal("preferences"),
    preferences: PreferencesSchema,
  }),
  z.object({
    type: z.literal("packages"),
    root: z.string(),
    packages: z.array(PublishTargetSchema),
    riskyConfirmationToken: z.string().optional(),
    /** True when the scanned root contains a `pnpm-workspace.yaml` — the UI
     *  uses this to offer a "Recursive Publish" action (Chapter 5.3 / 1.3.1). */
    isPnpmWorkspace: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("toast"),
    level: z.enum(["info", "success", "error", "warning"]),
    message: z.string(),
  }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

// ---------------------------------------------------------------------------
// Keychain: merged profile-auth item
// ---------------------------------------------------------------------------

export const ProfileSecretsSchema = z.object({
  npm_token: z.string(),
  totp_secret: z.string(),
  npm_pwd: z.string(),
});
export type ProfileSecrets = z.infer<typeof ProfileSecretsSchema>;
