/**
 * Daemon store — persistence for profiles.json / workspaces.json plus the
 * in-memory event log and credential pool (Chapter 4, 5.1).
 *
 * Config files are written atomically and NEVER contain secrets. Credentials
 * live only in the in-memory pool (populated from the OS keychain at startup,
 * Chapter 3.1).
 */
import { EventEmitter } from "node:events";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  type PnpmPubConfig,
  type Profile,
  type WorkspacesConfig,
  type WorkspaceEntry,
  type PubEvent,
  type EventKind,
  type EventPayload,
  type Preferences,
} from "../shared/index.js";
import {
  profilesPath,
  workspacesPath,
  preferencesPath,
  eventsDbPath,
  ensureAppDirs,
} from "../shared/paths.js";
import {
  PnpmPubConfigSchema,
  WorkspacesConfigSchema,
  PreferencesSchema,
  DEFAULT_PREFERENCES,
} from "../shared/schemas.js";
import {
  openEventDb,
  insertEvent,
  updateEvent,
  queryEvents as dbQueryEvents,
  recentEvents,
  type EventQuery,
  type EventQueryResult,
} from "./event-db.js";

const DEFAULT_CONFIG: PnpmPubConfig = { default: "", profiles: [] };
const DEFAULT_WORKSPACES: WorkspacesConfig = { paths: [] };
const DEFAULT_PREFS: Preferences = { ...DEFAULT_PREFERENCES };

type EventResolutionMetadata = Pick<PubEvent, "clockDriftRecovered"> & {
  tarballSummary?: PubEvent["tarballSummary"];
};

/** In-memory credential pool (Chapter 3.1 runtime phase). */
export interface CredentialPool {
  token: string;
  totpSecret: string;
  /** Stored npm password — used to silently re-mint an expired token. */
  npmPwd?: string;
}

export class DaemonStore extends EventEmitter {
  private config: PnpmPubConfig = { ...DEFAULT_CONFIG };
  private workspaces: WorkspacesConfig = { ...DEFAULT_WORKSPACES };
  private preferences: Preferences = { ...DEFAULT_PREFS };
  private events: PubEvent[] = [];
  private credentials = new Map<string, CredentialPool>();
  private eventDb: DatabaseType | null = null;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ----- lifecycle -----

  async load(): Promise<void> {
    ensureAppDirs();
    this.config =
      parsePnpmPubConfig(await this.readJson(profilesPath())) ?? structuredClone(DEFAULT_CONFIG);
    this.workspaces =
      parseWorkspacesConfig(await this.readJson(workspacesPath())) ??
      structuredClone(DEFAULT_WORKSPACES);
    // preferences use strip parsing (not strict) and fall back to defaults — a
    // missing/empty file is the common case on first run.
    this.preferences =
      parsePreferences(await this.readJson(preferencesPath())) ?? structuredClone(DEFAULT_PREFS);
    // Open the persisted event log. openEventDb sweeps orphan 'pending' rows to
    // 'failed' on startup, so the in-memory array is seeded from current DB state.
    this.eventDb = openEventDb(eventsDbPath());
    this.events = recentEvents(this.eventDb, 500);
  }

  /** Close the persisted event database (call on daemon shutdown). */
  close(): void {
    if (this.eventDb) {
      this.eventDb.close();
      this.eventDb = null;
    }
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      const text = await fsp.readFile(file, "utf8");
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    // Use a per-write unique temp path so concurrent writes to the same file
    // (e.g. an event-resolve + a profile update) don't clobber each other's
    // `.tmp` and leave one with an ENOENT on rename.
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fsp.rename(tmp, file);
  }

  // ----- profiles -----

  getProfiles(): Profile[] {
    return this.config.profiles;
  }

  getDefault(): string {
    return this.config.default;
  }

  getProfile(username: string): Profile | undefined {
    return this.config.profiles.find((p) => p.username === username);
  }

  async setDefault(username: string): Promise<boolean> {
    if (!this.getProfile(username)) return false;
    this.config.default = username;
    await this.writeJson(profilesPath(), this.config);
    this.emit("profiles", this.snapshotProfiles());
    return true;
  }

  async upsertProfile(profile: Profile): Promise<void> {
    const idx = this.config.profiles.findIndex((p) => p.username === profile.username);
    if (idx >= 0) this.config.profiles[idx] = profile;
    else this.config.profiles.push(profile);
    if (!this.config.default) this.config.default = profile.username;
    await this.writeJson(profilesPath(), this.config);
    this.emit("profiles", this.snapshotProfiles());
  }

  async removeProfile(username: string): Promise<boolean> {
    if (!this.getProfile(username)) return false;
    this.config.profiles = this.config.profiles.filter((p) => p.username !== username);
    if (this.config.default === username) {
      this.config.default = this.config.profiles[0]?.username ?? "";
    }
    this.credentials.delete(username);
    // Chapter 4.2: purge the profile's secrets from the OS keychain too, so a
    // deleted identity leaves no orphaned token/TOTP behind. Lazy import to
    // avoid a static cycle (keychain imports store types only).
    try {
      const keychain = await import("./keychain.js");
      await keychain.deleteProfile(username);
    } catch {
      /* keychain unavailable — config + memory already cleared */
    }
    await this.writeJson(profilesPath(), this.config);
    this.emit("profiles", this.snapshotProfiles());
    return true;
  }

  private snapshotProfiles() {
    return {
      type: "profiles" as const,
      default: this.config.default,
      profiles: [...this.config.profiles],
    };
  }

  // ----- credentials (in-memory only, Chapter 3.1) -----

  setCredentials(username: string, pool: CredentialPool): void {
    this.credentials.set(username, pool);
  }

  getCredentials(username: string): CredentialPool | undefined {
    return this.credentials.get(username);
  }

  clearCredentials(): void {
    this.credentials.clear();
  }

  deleteCredentials(username: string): void {
    this.credentials.delete(username);
  }

  // ----- workspaces -----

  getWorkspaces(): WorkspaceEntry[] {
    return this.workspaces.paths;
  }

  async addWorkspace(entry: WorkspaceEntry): Promise<void> {
    const existing = this.workspaces.paths.find((w) => w.path === entry.path);
    if (existing) {
      existing.pinned = entry.pinned;
      existing.addedAt = entry.addedAt;
    } else {
      this.workspaces.paths.push({
        path: entry.path,
        pinned: entry.pinned,
        addedAt: entry.addedAt,
      });
    }
    await this.writeJson(workspacesPath(), this.workspaces);
    this.emit("workspaces", {
      type: "workspaces" as const,
      workspaces: [...this.workspaces.paths],
    });
  }

  async removeWorkspace(path: string): Promise<boolean> {
    const idx = this.workspaces.paths.findIndex((w) => w.path === path);
    if (idx < 0) return false;
    this.workspaces.paths.splice(idx, 1);
    await this.writeJson(workspacesPath(), this.workspaces);
    this.emit("workspaces", {
      type: "workspaces" as const,
      workspaces: [...this.workspaces.paths],
    });
    return true;
  }

  /**
   * Risk-boundary confirmation state machine (Chapter 5.3.2).
   *
   * When a path is flagged as risky (no project markers, or a broad system
   * dir) the daemon stages it here WITHOUT writing to disk. Only after the
   * user explicitly confirms does `confirmRiskyWorkspace` persist it.
   */
  private riskyPending = new Map<string, WorkspaceEntry>();

  /** Stage a risky workspace for confirmation. Returns an opaque confirmation token. */
  stageRiskyWorkspace(entry: WorkspaceEntry): string {
    const token = randomUUID();
    this.riskyPending.set(token, entry);
    return token;
  }

  /** List currently-staged (unconfirmed) risky workspaces. */
  getStagedRiskyWorkspaces(): WorkspaceEntry[] {
    return [...this.riskyPending.values()];
  }

  /** Persist a previously-staged risky workspace after user confirmation. */
  async confirmRiskyWorkspace(token: string): Promise<boolean> {
    const entry = this.riskyPending.get(token);
    if (!entry) return false;
    this.riskyPending.delete(token);
    await this.addWorkspace(entry);
    return true;
  }

  /** Discard a staged risky workspace (user declined). */
  cancelRiskyWorkspace(token: string): void {
    this.riskyPending.delete(token);
  }

  async pinWorkspace(root: string, pinned: boolean): Promise<void> {
    const entry = this.workspaces.paths.find((w) => w.path === root);
    if (entry) {
      entry.pinned = pinned;
      await this.writeJson(workspacesPath(), this.workspaces);
      this.emit("workspaces", {
        type: "workspaces" as const,
        workspaces: [...this.workspaces.paths],
      });
    }
  }

  // ----- preferences (Chapter 6.4) -----

  getPreferences(): Preferences {
    return { ...this.preferences };
  }

  /** Persist the keepOnTop pin and emit a 'preferences' event. */
  async setKeepOnTop(keepOnTop: boolean): Promise<void> {
    if (this.preferences.keepOnTop === keepOnTop) return;
    this.preferences = { keepOnTop };
    await this.writeJson(preferencesPath(), this.preferences);
    this.emit("preferences", this.getPreferences());
  }

  // ----- events (Chapter 6.2) -----

  /**
   * Pending events for the WS initial snapshot. History is fetched via
   * queryEvents() / the REST endpoint (paginated from SQLite), so the WS
   * snapshot only carries live pending items.
   */
  getEvents(): PubEvent[] {
    return this.events
      .filter((e) => e.status === "pending")
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getEvent(id: string): PubEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  /** Paginated, filtered history query (backed by SQLite). */
  queryEvents(q: EventQuery): EventQueryResult {
    if (!this.eventDb) return { rows: [], total: 0, page: q.page, limit: q.limit };
    return dbQueryEvents(this.eventDb, q);
  }

  /**
   * Access the underlying event DB handle. Used by the web-server for the
   * TTL-cached repo-info resolver (and other derived/cached lookups). Returns
   * null when the DB isn't open (e.g. before `load()`).
   */
  getEventDb(): DatabaseType | null {
    return this.eventDb;
  }

  createEvent(opts: {
    kind: EventKind;
    profile: string;
    profileOverride?: string;
    payload?: EventPayload;
    groupId?: string;
  }): PubEvent {
    const evt: PubEvent = {
      id: randomUUID(),
      kind: opts.kind,
      status: "pending",
      profile: opts.profile,
      profileOverride: opts.profileOverride,
      createdAt: Date.now(),
      payload: opts.payload,
      groupId: opts.groupId,
    };
    this.events.unshift(evt);
    if (this.eventDb) insertEvent(this.eventDb, evt);
    this.emit("event", { type: "event" as const, event: evt });
    return evt;
  }

  resolveEvent(
    id: string,
    status: PubEvent["status"],
    result?: string,
    metadata?: EventResolutionMetadata,
  ): PubEvent | undefined {
    const evt = this.events.find((e) => e.id === id);
    if (!evt) return undefined;
    evt.status = status;
    evt.resolvedAt = Date.now();
    if (result !== undefined) evt.result = result;
    if (metadata?.clockDriftRecovered !== undefined) {
      evt.clockDriftRecovered = metadata.clockDriftRecovered;
    }
    if (metadata?.tarballSummary !== undefined) {
      evt.tarballSummary = metadata.tarballSummary;
    }
    if (this.eventDb) updateEvent(this.eventDb, evt);
    this.emit("event", { type: "event" as const, event: evt });
    return evt;
  }

  /**
   * Update a pending publish event's CLI args in place. Only honored for events
   * still in `pending` whose payload is a publish context — the scheduler holds
   * the SAME PubEvent instance in `this.pending`, and re-reads `args` live at
   * confirm time, so mutating the shared object makes the edit take effect on
   * the next confirm without any extra wiring. Returns the event on success, or
   * undefined when the event is missing / not pending / not a publish event.
   */
  updateEventArgs(id: string, args: string[]): PubEvent | undefined {
    const evt = this.events.find((e) => e.id === id);
    if (!evt || evt.status !== "pending") return undefined;
    // Both single-package `publish` and `recursive-publish` carry an editable
    // `args` array on their payload data.
    if (evt.payload?.kind !== "publish" && evt.payload?.kind !== "recursive-publish")
      return undefined;
    evt.payload.data.args = args;
    if (this.eventDb) updateEvent(this.eventDb, evt);
    this.emit("event", { type: "event" as const, event: evt });
    return evt;
  }
}

// ---------------------------------------------------------------------------
// Zod-backed config-file parsers (replaces all hand-written validators)
// ---------------------------------------------------------------------------

function parsePnpmPubConfig(value: unknown): PnpmPubConfig | null {
  const result = PnpmPubConfigSchema.safeParse(value);
  if (!result.success) return null;
  // Dedup usernames + validate default points to an existing profile.
  const usernames = new Set<string>();
  for (const p of result.data.profiles) {
    if (usernames.has(p.username)) return null;
    usernames.add(p.username);
  }
  const defaultProfile = result.data.profiles.some((p) => p.username === result.data.default)
    ? result.data.default
    : (result.data.profiles[0]?.username ?? "");
  return { default: defaultProfile, profiles: result.data.profiles };
}

function parseWorkspacesConfig(value: unknown): WorkspacesConfig | null {
  const result = WorkspacesConfigSchema.safeParse(value);
  if (!result.success) return null;
  // Dedup root paths.
  const roots = new Set<string>();
  for (const entry of result.data.paths) {
    if (!path.isAbsolute(entry.path)) return null;
    if (roots.has(entry.path)) return null;
    roots.add(entry.path);
  }
  return { paths: result.data.paths };
}

/**
 * Parse preferences.json with default-strip semantics. Missing file or a parse
 * failure yields null (caller falls back to DEFAULT_PREFS). A partial file
 * (e.g. only `keepOnTop`) merges over defaults so a forward-compatible field
 * added by a newer daemon doesn't break this reader.
 */
function parsePreferences(value: unknown): Preferences | null {
  const result = PreferencesSchema.safeParse(value);
  if (!result.success) return null;
  return { keepOnTop: result.data.keepOnTop };
}
