/**
 * WebUI mirror of the daemon protocol types (see src/shared/index.ts).
 *
 * These are duplicated (rather than imported) so the SvelteKit bundle contains
 * no Node-only code. Keep in sync with the daemon side.
 */

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

export interface OidcContext {
  repo: string;
  name: string;
  branch?: string;
  path: string;
  force?: boolean;
}

/**
 * npm Trusted Publishing (OIDC) trusted-publisher config — mirrors the
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

export interface CreatePlaceholderContext {
  name: string;
}

export interface RefreshTokenContext {
  username: string;
}

export interface UnpublishContext {
  name: string;
  version: string;
}

export type EventKind =
  | "publish"
  | "setup-oidc"
  | "create-placeholder"
  | "refresh-token"
  | "unpublish"
  | "recursive-publish";

export type EventStatus =
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "action-required"
  | "rejected";

export type EventPayload =
  | { kind: "publish"; data: PublishContext }
  | { kind: "setup-oidc"; data: OidcContext }
  | { kind: "create-placeholder"; data: CreatePlaceholderContext }
  | { kind: "refresh-token"; data: RefreshTokenContext }
  | { kind: "unpublish"; data: UnpublishContext }
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
  | { type: "profiles"; default: string; profiles: Profile[] }
  | { type: "workspaces"; workspaces: WorkspaceEntry[] }
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
      pinned: boolean;
      exitRequested: boolean;
      visibility: "hidden" | "shown";
      hasActiveEvents: boolean;
    };
