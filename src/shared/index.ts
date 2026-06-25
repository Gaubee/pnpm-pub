/**
 * @pnpm-pub/shared — shared type definitions, protocol contracts and data models.
 *
 * Implements the data models and IPC/WS protocol contracts described in:
 *  - Chapter 4: Data & Storage Design (profiles.json, workspaces.json, keychain mapping)
 *  - Chapter 3: Security & IPC Design (WebToken, IPC payloads)
 *  - Chapter 5: Daemon Core Design (events, pending state, profile override)
 *  - Chapter 8: Core Sequence Diagrams (event flows)
 */

// ---------------------------------------------------------------------------
// Chapter 4.1 — Local configuration: ~/.pnpm-pub/profiles.json
// ---------------------------------------------------------------------------

/** A single NPM identity profile. NEVER holds secrets (token/totp live in keychain). */
export interface Profile {
  /** Username — the unique profile id, kept consistent with NPM. */
  username: string;
  /** NPM registry endpoint. Defaults to https://registry.npmjs.org/ */
  registry?: string;
  /** Remote avatar URL or local cache id (optional). */
  avatarUrl?: string;
  /** Extension: branch / preferences used by the auto-generated GitHub Action script (optional). */
  ciPreferences?: Record<string, unknown>;
}

/** Top-level shape of ~/.pnpm-pub/profiles.json. Contains NO secrets. */
export interface PnpmPubConfig {
  /** Currently selected identity (points at a `profiles[].username`). */
  default: string;
  /** The list of managed identities. */
  profiles: Profile[];
}

// ---------------------------------------------------------------------------
// Chapter 5.3.3 — Workspaces: ~/.pnpm-pub/workspaces.json
// ---------------------------------------------------------------------------

export interface WorkspaceEntry {
  /** Absolute root path (the resolved project root, not a stray subdir). */
  path: string;
  /** Pinned / favorited by the user. */
  pinned: boolean;
  /** When the workspace was first recorded (ms epoch). */
  addedAt: number;
}

export interface WorkspacesConfig {
  paths: WorkspaceEntry[];
}

// ---------------------------------------------------------------------------
// Chapter 4.2 — OS keychain credential mapping
// ---------------------------------------------------------------------------

/** Fixed keychain service name (Chapter 4.2). */
export const KEYCHAIN_SERVICE = 'pnpm-pub' as const;

/** Build the keychain account key for an NPM token. */
export const tokenKey = (username: string): string => `${username}_npm_token`;
/** Build the keychain account key for a TOTP secret. */
export const totpKey = (username: string): string => `${username}_totp_secret`;

/** Sandbox service name used in tests so we never touch the dev's real credentials (Chapter 10.2). */
export const KEYCHAIN_SERVICE_SANDBOX = 'pnpm-pub-test-sandbox' as const;

// ---------------------------------------------------------------------------
// Chapter 8.2 — Encrypted backup / migration file (.json)
// ---------------------------------------------------------------------------

/** Plaintext-wrapped export bundle: profile list metadata + encrypted payload. */
export interface BackupBundle {
  /** Visible metadata so the importer can show the list before asking for a password. */
  profiles: string[];
  /** PBKDF2/scrypt salt (hex). */
  salt: string;
  /** AES-256-GCM initialization vector (hex). */
  iv: string;
  /** Ciphertext (hex) — AES-256-GCM authenticated. */
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Chapter 3.2.1 / 7.2 — CLI <-> Daemon IPC protocol
// ---------------------------------------------------------------------------

/** Top-level management sub-commands (Chapter 7.1). */
export type ManagementCommand = 'start' | 'status' | 'stop';

/** Payload sent by the thin CLI over the named pipe / unix socket. */
export interface IpcHandshake {
  /** CLI semver, so the daemon can self-destruct if it is older (Chapter 7.2.1). */
  cliVersion: string;
}

export interface IpcPublishRequest {
  command: 'publish';
  /** Absolute CWD captured by the CLI. */
  cwd: string;
  /** Raw `pnpm publish` compatible args. */
  args: string[];
  /** Explicit --profile override (optional, Chapter 5.4.5). */
  profileOverride?: string;
}

export interface IpcManagementRequest {
  command: ManagementCommand;
  profileOverride?: string;
}

export type IpcRequest = IpcHandshake | IpcPublishRequest | IpcManagementRequest;

/** Streaming log frame relayed from the daemon back to the CLI's terminal. */
export interface IpcLogFrame {
  type: 'stdout' | 'stderr';
  data: string;
}

export interface IpcExitFrame {
  type: 'exit';
  code: number;
  message?: string;
}

export interface IpcStatusFrame {
  type: 'status';
  active: boolean;
  profile?: string;
  pid?: number;
}

export type IpcFrame = IpcLogFrame | IpcExitFrame | IpcStatusFrame;

// ---------------------------------------------------------------------------
// Chapter 3.3 / 5.4 / 6.2 — Events hub (the pending wall)
// ---------------------------------------------------------------------------

export type EventKind =
  | 'publish' // Chapter 8.3 — terminal publish
  | 'setup-oidc' // Chapter 8.5 — Trusted Publish config
  | 'create-placeholder' // v0.0.0 placeholder publish
  | 'refresh-token' // force token refresh
  | 'import' // Chapter 8.2 import
  | 'export'; // Chapter 8.2 export

export type EventStatus = 'pending' | 'success' | 'failed' | 'expired' | 'rejected';

/**
 * An Event is the central unit of the Events Hub. Every action — whether CLI
 * triggered or GUI triggered — materialises as an Event that must be confirmed
 * before the daemon performs any write against the NPM registry (Chapter 3.3).
 */
export interface PublishTarget {
  name: string;
  version: string;
  /** Previous version, if discoverable, to render a diff. */
  previousVersion?: string;
  description?: string;
  path: string;
}

export interface PublishContext {
  cwd: string;
  args: string[];
  target: PublishTarget;
}

export interface OidcContext {
  /** Repo slug, e.g. owner/name. */
  repo: string;
  /** Package name the OIDC binding is requested for. */
  name: string;
  branch?: string;
  /** Absolute path to the package directory (workflow is written here). */
  path?: string;
  /** When true, overwrite an existing publish.yml (Chapter 1.2.3 --force). */
  force?: boolean;
}

export interface CreatePlaceholderContext {
  name: string;
  path: string;
}

export interface RefreshTokenContext {
  username: string;
}

export type EventPayload =
  | { kind: 'publish'; data: PublishContext }
  | { kind: 'setup-oidc'; data: OidcContext }
  | { kind: 'create-placeholder'; data: CreatePlaceholderContext }
  | { kind: 'refresh-token'; data: RefreshTokenContext };

export interface PubEvent {
  /** Unique task id (Chapter 3.3.1). */
  id: string;
  kind: EventKind;
  status: EventStatus;
  /** Which profile's credentials should be used to execute (resolved at confirm time). */
  profile: string;
  /**
   * When set, the event breaks profile isolation (Chapter 5.4.5 / 6.2.2):
   * the UI must prominently display this forced identity.
   */
  profileOverride?: string;
  createdAt: number;
  resolvedAt?: number;
  payload?: EventPayload;
  /** Human-readable result / error message after resolution. */
  result?: string;
  /** Whether a clock-drift retry path was exercised (Chapter 8.4). */
  clockDriftRecovered?: boolean;
}

// ---------------------------------------------------------------------------
// Chapter 3.2.2 / 5.2 — WebSocket protocol between WebUI and Daemon
// ---------------------------------------------------------------------------

/** Server -> Client: full or delta state. */
export type WsServerMessage =
  | { type: 'hello'; webTokenRequired: true }
  | { type: 'events'; events: PubEvent[] }
  | { type: 'event'; event: PubEvent }
  | { type: 'profiles'; default: string; profiles: Profile[] }
  | { type: 'workspaces'; workspaces: WorkspaceEntry[] }
  | { type: 'packages'; root: string; packages: PublishTarget[]; riskyConfirmationToken?: string }
  | { type: 'toast'; level: 'info' | 'success' | 'error' | 'warning'; message: string };

/**
 * Client -> Server action verbs over the authenticated WebSocket.
 *
 * NOTE: import/export are intentionally NOT WS verbs — they move large file
 * payloads, so the WebUI uses the token-guarded REST endpoints
 * (`/api/export`, `/api/import`) instead. Keeping these out of the WS protocol
 * avoids dead/misleading message types (Chapter 8.2).
 */
export type WsClientMessage =
  | { type: 'auth'; webToken: string }
  | { type: 'select-profile'; username: string }
  | { type: 'confirm-event'; id: string }
  | { type: 'reject-event'; id: string }
  | { type: 'scan-workspace'; root: string }
  | { type: 'create-event'; kind: EventKind; payload: unknown };

// ---------------------------------------------------------------------------
// Chapter 8.1 — Onboarding: automated token apply
// ---------------------------------------------------------------------------

/** Submitted by the WebUI during [Add Profile]. Password is burned after use. */
export interface AddProfilePayload {
  username: string;
  password: string;
  totpSecret: string;
  registry?: string;
}

/** Result of the automated token apply flow. */
export interface AddProfileResult {
  ok: boolean;
  /** Set when NPM silently rejected the auto-apply and the manual-paste fallback is required. */
  needsManualToken?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Fixed runtime directory under the user home. */
export const APP_DIR_NAME = '.pnpm-pub';

/** Resolved at runtime via env override; the canonical config filenames. */
export const PROFILES_FILE = 'profiles.json';
export const WORKSPACES_FILE = 'workspaces.json';
