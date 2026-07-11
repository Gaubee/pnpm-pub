/**
 * WebUI mirror of the daemon protocol types (see src/shared/index.ts).
 *
 * These are duplicated (rather than imported) so the SvelteKit bundle contains
 * no Node-only code. Keep in sync with the daemon side.
 */
import type { EventStatus as SharedEventStatus } from "$shared/index.js";

/**
 * App-wide preferences (mirrors `Preferences` in src/shared/schemas.ts). The
 * keep-open pin is a typed preference; `values` is a non-security free-form
 * record for small UI preferences parsed defensively by each consumer.
 */
export interface Preferences {
  keepOnTop: boolean;
  values: Record<string, unknown>;
}

export type AppUpdateManager = "npm" | "pnpm" | "yarn" | "bun" | "volta" | "vp" | "unknown";

export interface AppUpdateOwner {
  manager: AppUpdateManager;
  packageRoot: string | null;
  canUpdate: boolean;
  reason: string | null;
}

export interface AppUpdateSnapshot {
  currentVersion: string;
  runtimeVersions: { npm: string | null; pnpm: string | null };
  latestVersion: string | null;
  status: "idle" | "checking" | "up-to-date" | "available" | "error" | "installing";
  owner: AppUpdateOwner;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
  error: string | null;
}

/** Resolved daemon facts; these are received from the daemon, never inferred by the WebUI. */
export interface DaemonRuntimeInfo {
  pid: number;
  platform: string;
  appDir: string;
  profilesPath: string;
  eventsDbPath: string;
  daemonLogPath: string;
  credentialService: string;
}

export interface Profile {
  username: string;
  registry?: string;
  avatarUrl?: string;
  ciPreferences?: Record<string, unknown>;
  authStatus?: "authenticated" | "unauthenticated";
  autoRenew?: boolean;
}

/**
 * Live authenticated npm profile detail (mirrors the daemon's
 * `NpmProfileDetail` in src/daemon/npm-profile-client.ts). A projection of the
 * registry, never persisted — fetched on demand for the Profile detail page.
 */
export interface ProfileDetail {
  name: string | null;
  fullname: string | null;
  email: string | null;
  emailVerified: boolean | null;
  github: string | null;
  twitter: string | null;
  homepage: string | null;
  tfaEnabled: boolean | null;
  createdAt: string | null;
}

export interface WorkspaceEntry {
  path: string;
  pinned: boolean;
  addedAt: number;
}

export interface PublishConfig {
  registry?: string;
  tag?: string;
  access?: string;
}

export interface PublishTarget {
  name: string;
  version: string;
  previousVersion?: string;
  description?: string;
  path: string;
  repository?: string;
  publishConfig?: PublishConfig;
  publishable?: boolean;
  /** Present when `publishable === false`: `"private"` (package.json private).
   *  Scope ownership is NOT pre-judged — see daemon's isPublishableByProfile. */
  unpublishableReason?: "private";
}

/**
 * A package published/maintained by the active profile on the npm registry.
 * Mirrors the daemon's `NpmPackage` (src/daemon/npm-packages.ts) — duplicated
 * (no Node-only code in the browser bundle), kept in sync.
 */
export interface NpmPackage {
  name: string;
  version: string;
  description?: string | null;
  repository?: string | null;
  date?: string | null;
  scope?: string | null;
  keywords?: string[];
  score?: number;
}

/**
 * A collaborator/maintainer of a package (mirrors the daemon's
 * `PackageCollaborator` in src/shared/index.ts). `access` is the npm access
 * level when available (e.g. 'read'/'write'); `email` only comes from the
 * packument maintainers list, not the access endpoint.
 */
export interface PackageCollaborator {
  username: string;
  access?: string;
  email?: string;
}

/**
 * Projected package detail (PackageDetail page). Mirrors the daemon's
 * `PackageDetail` projection (src/daemon/npm-package-detail.ts) — a merge of the
 * registry packument (readme/license/repository/homepage/versions/time),
 * collaborators, and weekly downloads. Never persisted.
 */
export interface PackageDetail {
  name: string;
  version: string;
  description: string | null;
  readme: string;
  license: string | null;
  repository: string | null;
  repositoryDirectory: string | null;
  repositoryBrowseUrl: string | null;
  repositoryBrowseFileTemplate: string | null;
  repositoryRawFileTemplate: string | null;
  homepage: string | null;
  lastPublish: string | null;
  modified: string | null;
  keywords: string[];
  collaborators: PackageCollaborator[];
  weeklyDownloads: number;
}

export type PublishSource = { kind: "directory"; path: string } | { kind: "tarball"; path: string };

export interface PublishContext {
  source: PublishSource;
  args: string[];
  target: PublishTarget;
  /** Current git branch of the publish source (daemon-filled hint for the
   *  publish-branch option). Absent/empty when not a git repo. */
  branch?: string;
}

export interface RecursivePublishContext {
  source: PublishSource;
  args: string[];
  /** The packages that will be published (enumerated via `pnpm list -r`). */
  targets: PublishTarget[];
  branch?: string;
}

/**
 * npm Trusted Publishing trusted-publisher config — mirrors the
 * `TrustedPublisherConfig` in src/shared/index.ts (the daemon owns the network
 * call; the webui only ever mirrors these types).
 */
export type TrustedPublisherType = "github" | "circleci" | "gitlab";
export type TrustedPublisherPermission = "createPackage" | "createStagedPackage";
export interface TrustedPublisherBase {
  id?: string;
  permissions: TrustedPublisherPermission[];
}
export interface GithubActionsPublisher extends TrustedPublisherBase {
  type: "github";
  claims: { repository: string; workflow_ref: { file: string }; environment?: string };
}
export interface CircleCiPublisher extends TrustedPublisherBase {
  type: "circleci";
  claims: {
    "oidc.circleci.com/org-id": string;
    "oidc.circleci.com/project-id": string;
    "oidc.circleci.com/pipeline-definition-id": string;
    "oidc.circleci.com/context-ids"?: string[];
    "oidc.circleci.com/vcs-origin": string;
  };
}
export interface GitlabCiPublisher extends TrustedPublisherBase {
  type: "gitlab";
  claims: { project_path: string; ci_config_ref_uri?: string; environment?: string };
}
export type TrustedPublisherConfig = GithubActionsPublisher | CircleCiPublisher | GitlabCiPublisher;
export type TrustedPublisherRegistryConfig = TrustedPublisherConfig & { id: string };
export type TrustedPublisherCreateConfig =
  | Omit<GithubActionsPublisher, "id">
  | Omit<CircleCiPublisher, "id">
  | Omit<GitlabCiPublisher, "id">;
export type TrustedPublishingOperation = "add" | "update" | "remove";
/** Explicit human review of one trusted-publisher config. */
export type RemovalDecision = "remove" | "keep";
export type RemovalDecisions = Record<string, RemovalDecision>;
export interface TrustedPublishingTarget {
  name: string;
  path?: string;
  repository?: string;
  currentConfig?: TrustedPublisherConfig;
}
export interface ConfigureTrustContext {
  action: TrustedPublishingOperation;
  target: TrustedPublishingTarget;
  config?: TrustedPublisherCreateConfig;
  /** The workspace root the OIDC action was initiated from (recursive /
   *  workspace-detail batch). Used for the group card's "open folder" action. */
  root?: string;
}

export interface CreatePlaceholderContext {
  name: string;
  args: string[];
}

export interface RefreshTokenContext {
  username: string;
}

export interface UnpublishContext {
  name: string;
  version: string;
}

export interface DeletePackageContext {
  name: string;
}

export type EventKind =
  | "publish"
  | "configure-trust"
  | "create-placeholder"
  | "refresh-token"
  | "unpublish"
  | "delete-package"
  | "recursive-publish";

export type EventStatus = SharedEventStatus;

export type EventPayload =
  | { kind: "publish"; data: PublishContext }
  | { kind: "configure-trust"; data: ConfigureTrustContext }
  | { kind: "create-placeholder"; data: CreatePlaceholderContext }
  | { kind: "refresh-token"; data: RefreshTokenContext }
  | { kind: "unpublish"; data: UnpublishContext }
  | { kind: "delete-package"; data: DeletePackageContext }
  | { kind: "recursive-publish"; data: RecursivePublishContext };

/** Payload data shape for one concrete Event kind. */
export type EventPayloadData<K extends EventKind> = Extract<EventPayload, { kind: K }>["data"];

export interface TarballFile {
  path: string;
  size: number;
  mode: number;
}

export interface TarballSummary {
  files: TarballFile[];
  unpackedSize: number;
  entryCount: number;
  bundled: string[];
}

export interface PubEvent {
  id: string;
  kind: EventKind;
  status: EventStatus;
  profile: string;
  profileOverride?: string;
  createdAt: number;
  resolvedAt?: number;
  payload?: EventPayload;
  result?: string;
  clockDriftRecovered?: boolean;
  /** Batch correlation id — events sharing a groupId were created together. */
  groupId?: string;
  /** Registry configs captured when a removal Event is created. */
  removalSnapshot?: TrustedPublisherRegistryConfig[];
  /** Explicit human decisions keyed by registry trusted-publisher config id. */
  removalDecisions?: RemovalDecisions;
  /** Packed-tarball file list, cached when the publish runs (dry or real). */
  tarballSummary?: TarballSummary;
  /** Per-target tarball summaries for a recursive publish (one per target). */
  tarballSummaries?: { name: string; version: string; summary: TarballSummary }[];
}

export interface BackupBundle {
  profiles: string[];
  salt: string;
  iv: string;
  ciphertext: string;
}

export type WsServerMessage =
  | { type: "hello"; webTokenRequired: true }
  | { type: "events"; events: PubEvent[] }
  | { type: "event"; event: PubEvent }
  | {
      type: "group-trust-draft";
      groupId: string;
      defaultConfig?: TrustedPublisherCreateConfig;
      inheritMembers: string[];
    }
  | { type: "profiles"; default: string; profiles: Profile[] }
  | { type: "workspaces"; workspaces: WorkspaceEntry[] }
  | { type: "runtime-info"; info: DaemonRuntimeInfo }
  | { type: "app-update"; update: AppUpdateSnapshot }
  | {
      type: "packages";
      root: string;
      packages: PublishTarget[];
      riskyConfirmationToken?: string;
      isPnpmWorkspace?: boolean;
    }
  | { type: "toast"; level: "info" | "success" | "error" | "warning"; message: string }
  | {
      type: "pin";
      exitRequested: boolean;
      visibility: "hidden" | "shown";
      hasActiveEvents: boolean;
    }
  | { type: "preferences"; preferences: Preferences };
