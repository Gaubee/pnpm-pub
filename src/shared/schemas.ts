/**
 * Zod schemas — the single source of truth for every type that crosses a
 * serialization boundary (config files, WS protocol, REST bodies/responses,
 * keychain items, backup bundles, npm API responses).
 *
 * Types are derived via `z.infer<typeof Schema>` and re-exported from
 * `src/shared/index.ts`. Daemon and webui both import from here. No Node-only
 * APIs are used — pure Zod + pure types, safe for browser bundling.
 *
 * Convention:
 *   - Config files (profiles.json, workspaces.json): `.strict()` — reject
 *     unknown fields so a typo doesn't silently create a broken profile.
 *   - WS / REST protocol: `.passthrough()` — forward-compatible so a newer
 *     daemon adding a field doesn't break an older webui.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config: profiles.json
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  username: z.string().min(1),
  registry: z.string().optional(),
  avatarUrl: z.string().optional(),
  ciPreferences: z.record(z.string(), z.unknown()).optional(),
  authStatus: z.enum(['authenticated', 'unauthenticated']).optional(),
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

export const ManagementCommandSchema = z.enum(['start', 'status', 'stop']);
export type ManagementCommand = z.infer<typeof ManagementCommandSchema>;

export const IpcHandshakeSchema = z.object({
  cliVersion: z.string(),
});
export type IpcHandshake = z.infer<typeof IpcHandshakeSchema>;

export const IpcPublishRequestSchema = z.object({
  command: z.literal('publish'),
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
  type: z.enum(['stdout', 'stderr']),
  data: z.string(),
});
export type IpcLogFrame = z.infer<typeof IpcLogFrameSchema>;

export const IpcExitFrameSchema = z.object({
  type: z.literal('exit'),
  code: z.number(),
  message: z.string().optional(),
});
export type IpcExitFrame = z.infer<typeof IpcExitFrameSchema>;

export const IpcStatusFrameSchema = z.object({
  type: z.literal('status'),
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
  'publish',
  'setup-oidc',
  'create-placeholder',
  'refresh-token',
]);
export type EventKind = z.infer<typeof EventKindSchema>;

export const EventStatusSchema = z.enum([
  'pending',
  'success',
  'failed',
  'expired',
  'action-required',
  'rejected',
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

export const PublishSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('directory'), path: z.string() }),
  z.object({ kind: z.literal('tarball'), path: z.string() }),
]);
export type PublishSource = z.infer<typeof PublishSourceSchema>;

export const PublishContextSchema = z.object({
  source: PublishSourceSchema,
  args: z.array(z.string()),
  target: PublishTargetSchema,
});
export type PublishContext = z.infer<typeof PublishContextSchema>;

export const OidcContextSchema = z.object({
  repo: z.string(),
  name: z.string(),
  branch: z.string().optional(),
  path: z.string(),
  force: z.boolean().optional(),
});
export type OidcContext = z.infer<typeof OidcContextSchema>;

export const CreatePlaceholderContextSchema = z.object({
  name: z.string(),
});
export type CreatePlaceholderContext = z.infer<typeof CreatePlaceholderContextSchema>;

export const RefreshTokenContextSchema = z.object({
  username: z.string(),
});
export type RefreshTokenContext = z.infer<typeof RefreshTokenContextSchema>;

export const EventPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('publish'), data: PublishContextSchema }),
  z.object({ kind: z.literal('setup-oidc'), data: OidcContextSchema }),
  z.object({ kind: z.literal('create-placeholder'), data: CreatePlaceholderContextSchema }),
  z.object({ kind: z.literal('refresh-token'), data: RefreshTokenContextSchema }),
]);
export type EventPayload = z.infer<typeof EventPayloadSchema>;

export type EventPayloadData<K extends EventKind> = Extract<EventPayload, { kind: K }>['data'];

export const PubEventSchema = z.object({
  id: z.string(),
  kind: EventKindSchema,
  status: EventStatusSchema,
  profile: z.string(),
  profileOverride: z.string().optional(),
  createdAt: z.number(),
  resolvedAt: z.number().optional(),
  payload: EventPayloadSchema.optional(),
  result: z.string().optional(),
  clockDriftRecovered: z.boolean().optional(),
});
export type PubEvent = z.infer<typeof PubEventSchema>;

// ---------------------------------------------------------------------------
// Trusted Publishing (OIDC) — npm /trust API
// ---------------------------------------------------------------------------

export const TrustedPublisherTypeSchema = z.enum(['github', 'circleci', 'gitlab']);
export type TrustedPublisherType = z.infer<typeof TrustedPublisherTypeSchema>;

export const TrustedPublisherPermissionSchema = z.enum([
  'createPackage',
  'createStagedPackage',
]);
export type TrustedPublisherPermission = z.infer<typeof TrustedPublisherPermissionSchema>;

const TrustedPublisherBaseSchema = z.object({
  id: z.string().optional(),
  permissions: z.array(TrustedPublisherPermissionSchema),
});

export const GithubActionsPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal('github'),
  claims: z.object({
    repository: z.string(),
    workflow_ref: z.object({ file: z.string() }),
    environment: z.string().optional(),
  }),
});
export type GithubActionsPublisher = z.infer<typeof GithubActionsPublisherSchema>;

export const CircleCiPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal('circleci'),
  claims: z.object({
    repository: z.string(),
    context: z.string().optional(),
    environment: z.string().optional(),
  }),
});
export type CircleCiPublisher = z.infer<typeof CircleCiPublisherSchema>;

export const GitlabCiPublisherSchema = TrustedPublisherBaseSchema.extend({
  type: z.literal('gitlab'),
  claims: z.object({
    project: z.string(),
    ref: z.string().optional(),
    environment: z.string().optional(),
  }),
});
export type GitlabCiPublisher = z.infer<typeof GitlabCiPublisherSchema>;

export const TrustedPublisherConfigSchema = z.discriminatedUnion('type', [
  GithubActionsPublisherSchema,
  CircleCiPublisherSchema,
  GitlabCiPublisherSchema,
]);
export type TrustedPublisherConfig = z.infer<typeof TrustedPublisherConfigSchema>;

// ---------------------------------------------------------------------------
// WS protocol
// ---------------------------------------------------------------------------

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), webTokenRequired: z.literal(true) }),
  z.object({ type: z.literal('events'), events: z.array(PubEventSchema) }),
  z.object({ type: z.literal('event'), event: PubEventSchema }),
  z.object({ type: z.literal('profiles'), default: z.string(), profiles: z.array(ProfileSchema) }),
  z.object({ type: z.literal('workspaces'), workspaces: z.array(WorkspaceEntrySchema) }),
  z.object({
    type: z.literal('packages'),
    root: z.string(),
    packages: z.array(PublishTargetSchema),
    riskyConfirmationToken: z.string().optional(),
  }),
  z.object({
    type: z.literal('toast'),
    level: z.enum(['info', 'success', 'error', 'warning']),
    message: z.string(),
  }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), webToken: z.string() }),
  z.object({ type: z.literal('select-profile'), username: z.string() }),
  z.object({ type: z.literal('confirm-event'), id: z.string() }),
  z.object({ type: z.literal('reject-event'), id: z.string() }),
  z.object({ type: z.literal('scan-workspace'), root: z.string() }),
  z.object({ type: z.literal('create-event'), kind: EventKindSchema, payload: z.unknown() }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

// ---------------------------------------------------------------------------
// Keychain: merged profile-auth item
// ---------------------------------------------------------------------------

export const ProfileSecretsSchema = z.object({
  npm_token: z.string(),
  totp_secret: z.string(),
  npm_pwd: z.string(),
});
export type ProfileSecrets = z.infer<typeof ProfileSecretsSchema>;
