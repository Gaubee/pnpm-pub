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
import type { Database as DatabaseType } from "./db.js";
import {
  type PnpmPubConfig,
  type Profile,
  type WorkspacesConfig,
  type WorkspaceEntry,
  type PubEvent,
  type EventKind,
  type EventPayload,
  type Preferences,
  type TrustedPublisherCreateConfig,
  type ConfigureTrustContext,
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
  queryHistoryGroups as dbQueryHistoryGroups,
  recentEvents,
  type EventQuery,
  type EventQueryResult,
  type HistoryEventGroupQuery,
  type HistoryEventGroupQueryResult,
} from "./event-db.js";

const DEFAULT_CONFIG: PnpmPubConfig = { default: "", profiles: [] };
const DEFAULT_WORKSPACES: WorkspacesConfig = { paths: [] };
const DEFAULT_PREFS: Preferences = structuredClone(DEFAULT_PREFERENCES);

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
  private preferences: Preferences = structuredClone(DEFAULT_PREFS);
  private events: PubEvent[] = [];
  private credentials = new Map<string, CredentialPool>();
  private eventDb: DatabaseType | null = null;
  /**
   * Trusted-publishing group inheritance state (in-memory, follows the group's
   * pending lifecycle). Kept here as the SINGLE SOURCE OF TRUTH so it survives
   * WebUI refreshes (re-sent on hello) and so confirm-time resolution is
   * unambiguous.
   *
   *   - `groupTrustDefaults`: the ONE shared draft config per group. Editing
   *     the group's default form updates ONLY this — it never fans out into
   *     member payloads (that fan-out was the root cause of the per-keystroke
   *     N×echo / 100% CPU loop).
   *   - `groupInheritMembers`: the EXPLICIT set of member ids that inherit the
   *     group default (rather than carrying their own `payload.data.config`).
   *     `config` presence on a member is NOT used to infer inheritance — that
   *     would couple two concerns. This set is the explicit marker.
   *
   * Resolution (`resolveConfigureTrustConfig`): inherit member → group default;
   * custom member → its own `payload.data.config`.
   */
  private groupTrustDefaults = new Map<string, TrustedPublisherCreateConfig>();
  private groupInheritMembers = new Map<string, Set<string>>();

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
      // Re-scan / auto-collect must NOT clobber user-set pin state or the
      // original add time. Only `path` is the identity key; pinned/addedAt
      // are user-meaningful and must be preserved across re-touches.
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

  /**
   * Persist a partial preferences patch and emit a 'preferences' event. The
   * patch is merged over the current preferences so callers only name the
   * field(s) they change; a no-op patch (yielding the same object) emits
   * nothing. This is the single write path for all app-wide preferences — the
   * keep-open pin and any future field.
   */
  async setPreferences(patch: Partial<Preferences>): Promise<void> {
    const merged = {
      ...this.preferences,
      ...patch,
      values: patch.values
        ? { ...this.preferences.values, ...patch.values }
        : this.preferences.values,
    };
    if (JSON.stringify(merged) === JSON.stringify(this.preferences)) return;
    this.preferences = merged;
    await this.writeJson(preferencesPath(), this.preferences);
    this.emit("preferences", this.getPreferences());
  }

  // ----- events (Chapter 6.2) -----

  /**
   * Events for the live WebUI projection.
   *
   * Always includes every pending event. Additionally, when a group has ANY
   * pending member, ALL of that group's members are included (even resolved
   * ones) so the WebUI can render a complete GroupEvent card — e.g. a batch
   * where 3 packages already succeeded and 2 are still pending shows all 5.
   *
   * History beyond these active groups is fetched via queryEvents() over oRPC
   * (paginated from SQLite), so this snapshot stays small.
   */
  getEvents(): PubEvent[] {
    const all = this.events;
    // Collect groupIds that have at least one pending member.
    const activeGroupIds = new Set<string>();
    for (const e of all) {
      if (e.status === "pending" && e.groupId) activeGroupIds.add(e.groupId);
    }
    return all
      .filter(
        (e) => e.status === "pending" || (e.groupId !== undefined && activeGroupIds.has(e.groupId)),
      )
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

  /** Paginated grouped history query (backed by SQLite). */
  queryHistoryGroups(q: HistoryEventGroupQuery): HistoryEventGroupQueryResult {
    if (!this.eventDb) return { groups: [], totalGroups: 0, page: q.page, limit: q.limit };
    return dbQueryHistoryGroups(this.eventDb, q);
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
    // A new configure-trust group member inherits the group default by default.
    // (Only "add" / "update" members participate — "remove" members have no
    // editable config.) This is the explicit inheritance marker — see the
    // groupInheritMembers comment above.
    if (
      opts.groupId &&
      opts.payload?.kind === "configure-trust" &&
      opts.payload.data.action !== "remove"
    ) {
      const set = this.groupInheritMembers.get(opts.groupId);
      if (set) set.add(evt.id);
      else this.groupInheritMembers.set(opts.groupId, new Set([evt.id]));
      this.emitGroupTrustDraft(opts.groupId);
    }
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
    this.cleanupGroupTrustState(evt);
    return evt;
  }

  /**
   * Drop the resolved member from its group's inheritance set, and if no
   * pending members remain in the group, drop the group's default + inheritance
   * state entirely (the group is done). Keeps the in-memory maps bounded.
   */
  private cleanupGroupTrustState(evt: PubEvent): void {
    const groupId = evt.groupId;
    if (!groupId) return;
    const set = this.groupInheritMembers.get(groupId);
    if (set) {
      set.delete(evt.id);
      if (set.size === 0) this.groupInheritMembers.delete(groupId);
    }
    const hasPending = this.events.some((e) => e.groupId === groupId && e.status === "pending");
    if (!hasPending) {
      this.groupTrustDefaults.delete(groupId);
      if (this.groupInheritMembers.has(groupId)) {
        this.groupInheritMembers.delete(groupId);
      }
    }
  }

  /**
   * Update a pending publish event's CLI args in place. The scheduler holds
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

  updateConfigureTrustDraft(
    id: string,
    config: TrustedPublisherCreateConfig,
  ): PubEvent | undefined {
    const evt = this.events.find((e) => e.id === id);
    if (!evt || evt.status !== "pending") return undefined;
    if (evt.payload?.kind !== "configure-trust") return undefined;
    evt.payload.data.config = config;
    // Writing a member's own config is, by definition, a custom edit. Ensure
    // the member is NOT marked inherit (defense-in-depth: the UI toggles first,
    // but a stale inherit flag would otherwise hide this config at resolve time).
    if (evt.groupId) {
      const set = this.groupInheritMembers.get(evt.groupId);
      if (set && set.delete(id)) this.emitGroupTrustDraft(evt.groupId);
    }
    if (this.eventDb) updateEvent(this.eventDb, evt);
    this.emit("event", { type: "event" as const, event: evt });
    return evt;
  }

  /**
   * Update the group's SHARED default trusted-publishing draft. Stores ONE copy
   * (per group) and emits a SINGLE lightweight `group-trust-draft` frame — it
   * does NOT fan the config out into every member's payload, and does NOT emit
   * per-member `"event"` frames. (The previous fan-out was the root cause of
   * per-keystroke N×echo / 100% CPU when editing the default form.) Inherit
   * members resolve to this default at display time and confirm time.
   *
   * Returns the member ids currently participating in the group (pending
   * configure-trust add/update members), for the caller's response.
   */
  updateConfigureTrustGroupDraft(groupId: string, config: TrustedPublisherCreateConfig): string[] {
    this.groupTrustDefaults.set(groupId, config);
    this.emitGroupTrustDraft(groupId);
    return this.groupMemberIds(groupId);
  }

  /** Member ids of pending configure-trust add/update members in a group. */
  private groupMemberIds(groupId: string): string[] {
    const ids: string[] = [];
    for (const evt of this.events) {
      if (evt.status !== "pending") continue;
      if (evt.groupId !== groupId) continue;
      if (evt.payload?.kind !== "configure-trust") continue;
      if (evt.payload.data.action === "remove") continue;
      ids.push(evt.id);
    }
    return ids;
  }

  /** Snapshot of a group's trust-draft state for WS broadcast / hello. */
  getGroupTrustDraft(groupId: string): {
    defaultConfig: TrustedPublisherCreateConfig | undefined;
    inheritMembers: string[];
  } {
    return {
      defaultConfig: this.groupTrustDefaults.get(groupId),
      inheritMembers: [...(this.groupInheritMembers.get(groupId) ?? [])],
    };
  }

  /** Snapshots for ALL groups that currently have pending members (hello frame). */
  getAllGroupTrustDrafts(): {
    groupId: string;
    defaultConfig: TrustedPublisherCreateConfig;
    inheritMembers: string[];
  }[] {
    const out: {
      groupId: string;
      defaultConfig: TrustedPublisherCreateConfig;
      inheritMembers: string[];
    }[] = [];
    for (const [groupId, defaultConfig] of this.groupTrustDefaults) {
      out.push({
        groupId,
        defaultConfig,
        inheritMembers: [...(this.groupInheritMembers.get(groupId) ?? [])],
      });
    }
    return out;
  }

  /** Whether a member currently inherits its group's default config. */
  isInheritMember(eventId: string, groupId: string): boolean {
    return this.groupInheritMembers.get(groupId)?.has(eventId) ?? false;
  }

  /**
   * Explicitly toggle a member between inherit (uses the group default) and
   * custom (carries its own `payload.data.config`). This is the SINGLE source of
   * truth for inheritance — `config` presence is NOT used to infer it.
   *
   *   - inherit=true : add to the set; clear any prior custom config on the
   *     member so it no longer carries a stale override.
   *   - inherit=false: remove from the set; the member's own config is then
   *     authored by the per-member form (`updateConfigureTrustDraft`).
   *
   * Returns the member's groupId (for the broadcast) or undefined if the member
   * is not a pending configure-trust add/update member of a group.
   */
  setMemberInherit(eventId: string, inherit: boolean): string | undefined {
    const evt = this.events.find((e) => e.id === eventId);
    if (!evt || evt.status !== "pending") return undefined;
    if (evt.payload?.kind !== "configure-trust") return undefined;
    if (evt.payload.data.action === "remove") return undefined;
    const groupId = evt.groupId;
    if (!groupId) return undefined;
    let set = this.groupInheritMembers.get(groupId);
    if (!set) {
      set = new Set();
      this.groupInheritMembers.set(groupId, set);
    }
    if (inherit) {
      set.add(eventId);
      // Returning to inherit: drop any custom override so the member no longer
      // carries a stale per-member config alongside the inherited default.
      if (evt.payload.data.config) {
        delete evt.payload.data.config;
        if (this.eventDb) updateEvent(this.eventDb, evt);
        this.emit("event", { type: "event" as const, event: evt });
      }
    } else {
      set.delete(eventId);
    }
    this.emitGroupTrustDraft(groupId);
    return groupId;
  }

  /**
   * Resolve the EFFECTIVE trusted-publishing config for an event at confirm (or
   * display) time, applying the inheritance rule:
   *   - inherit member → the group's shared default;
   *   - custom member  → the member's own `payload.data.config`.
   * Returns the (possibly synthesized) ConfigureTrustContext. Callers that need
   * only the config value can read `.config`.
   */
  resolveConfigureTrustConfig(evt: PubEvent): ConfigureTrustContext {
    const ctx: ConfigureTrustContext | undefined =
      evt.payload?.kind === "configure-trust" ? evt.payload.data : undefined;
    if (!ctx) return undefined as unknown as ConfigureTrustContext;
    // remove actions have no editable config and never inherit.
    if (ctx.action === "remove") return ctx;
    // Custom member: use its own config as-is.
    if (evt.groupId && !this.isInheritMember(evt.id, evt.groupId)) {
      return ctx;
    }
    // Inherit member (or a standalone event with no group): fall back to the
    // group default when the member has no own config.
    const def = evt.groupId ? this.groupTrustDefaults.get(evt.groupId) : undefined;
    if (def) return { ...ctx, config: def };
    return ctx;
  }

  /** Emit a single `group-trust-draft` frame for a group (no per-member echo). */
  private emitGroupTrustDraft(groupId: string): void {
    const draft = this.getGroupTrustDraft(groupId);
    this.emit("group-trust-draft", {
      type: "group-trust-draft" as const,
      groupId,
      defaultConfig: draft.defaultConfig,
      inheritMembers: draft.inheritMembers,
    });
  }

  invalidateTrustedPublishing(names: string[]): void {
    const unique = [...new Set(names.filter((name) => name.trim().length > 0))];
    if (unique.length === 0) return;
    this.emit("trusted-publishing", { names: unique });
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
 * added by a newer daemon doesn't break this reader. The parsed data is passed
 * through directly (not reconstructed field-by-field) so newly added
 * PreferencesSchema fields are picked up without touching this function.
 */
function parsePreferences(value: unknown): Preferences | null {
  const result = PreferencesSchema.safeParse(value);
  if (!result.success) return null;
  return result.data;
}
