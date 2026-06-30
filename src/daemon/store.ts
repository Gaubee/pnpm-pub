/**
 * Daemon store — persistence for profiles.json / workspaces.json plus the
 * in-memory event log and credential pool (Chapter 4, 5.1).
 *
 * Config files are written atomically and NEVER contain secrets. Credentials
 * live only in the in-memory pool (populated from the OS keychain at startup,
 * Chapter 3.1).
 */
import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type PnpmPubConfig,
  type Profile,
  type WorkspacesConfig,
  type WorkspaceEntry,
  type PubEvent,
  type EventKind,
  type EventPayload,
} from '../shared/index.js';
import { profilesPath, workspacesPath, ensureAppDirs } from '../shared/paths.js';

const DEFAULT_CONFIG: PnpmPubConfig = { default: '', profiles: [] };
const DEFAULT_WORKSPACES: WorkspacesConfig = { paths: [] };

type EventResolutionMetadata = Pick<PubEvent, 'clockDriftRecovered'>;

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
  private events: PubEvent[] = [];
  private credentials = new Map<string, CredentialPool>();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  // ----- lifecycle -----

  async load(): Promise<void> {
    ensureAppDirs();
    this.config = parsePnpmPubConfig(await this.readJson(profilesPath())) ?? structuredClone(DEFAULT_CONFIG);
    this.workspaces = parseWorkspacesConfig(await this.readJson(workspacesPath())) ?? structuredClone(DEFAULT_WORKSPACES);
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      const text = await fsp.readFile(file, 'utf8');
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
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
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
    this.emit('profiles', this.snapshotProfiles());
    return true;
  }

  async upsertProfile(profile: Profile): Promise<void> {
    const idx = this.config.profiles.findIndex((p) => p.username === profile.username);
    if (idx >= 0) this.config.profiles[idx] = profile;
    else this.config.profiles.push(profile);
    if (!this.config.default) this.config.default = profile.username;
    await this.writeJson(profilesPath(), this.config);
    this.emit('profiles', this.snapshotProfiles());
  }

  async removeProfile(username: string): Promise<boolean> {
    if (!this.getProfile(username)) return false;
    this.config.profiles = this.config.profiles.filter((p) => p.username !== username);
    if (this.config.default === username) {
      this.config.default = this.config.profiles[0]?.username ?? '';
    }
    this.credentials.delete(username);
    // Chapter 4.2: purge the profile's secrets from the OS keychain too, so a
    // deleted identity leaves no orphaned token/TOTP behind. Lazy import to
    // avoid a static cycle (keychain imports store types only).
    try {
      const keychain = await import('./keychain.js');
      await keychain.deleteProfile(username);
    } catch {
      /* keychain unavailable — config + memory already cleared */
    }
    await this.writeJson(profilesPath(), this.config);
    this.emit('profiles', this.snapshotProfiles());
    return true;
  }

  private snapshotProfiles() {
    return { type: 'profiles' as const, default: this.config.default, profiles: [...this.config.profiles] };
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
      this.workspaces.paths.push({ path: entry.path, pinned: entry.pinned, addedAt: entry.addedAt });
    }
    await this.writeJson(workspacesPath(), this.workspaces);
    this.emit('workspaces', { type: 'workspaces' as const, workspaces: [...this.workspaces.paths] });
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
      this.emit('workspaces', { type: 'workspaces' as const, workspaces: [...this.workspaces.paths] });
    }
  }

  // ----- events (Chapter 6.2) -----

  getEvents(): PubEvent[] {
    return [...this.events].sort((a, b) => b.createdAt - a.createdAt);
  }

  getEvent(id: string): PubEvent | undefined {
    return this.events.find((e) => e.id === id);
  }

  createEvent(opts: {
    kind: EventKind;
    profile: string;
    profileOverride?: string;
    payload?: EventPayload;
  }): PubEvent {
    const evt: PubEvent = {
      id: randomUUID(),
      kind: opts.kind,
      status: 'pending',
      profile: opts.profile,
      profileOverride: opts.profileOverride,
      createdAt: Date.now(),
      payload: opts.payload,
    };
    this.events.unshift(evt);
    this.emit('event', { type: 'event' as const, event: evt });
    return evt;
  }

  resolveEvent(
    id: string,
    status: PubEvent['status'],
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
    this.emit('event', { type: 'event' as const, event: evt });
    return evt;
  }
}

function parsePnpmPubConfig(value: unknown): PnpmPubConfig | null {
  if (!isRecord(value) || typeof value.default !== 'string' || !Array.isArray(value.profiles)) return null;
  const profiles: Profile[] = [];
  const usernames = new Set<string>();
  for (const profile of value.profiles) {
    const parsed = parseProfile(profile);
    if (!parsed) return null;
    if (usernames.has(parsed.username)) return null;
    usernames.add(parsed.username);
    profiles.push(parsed);
  }
  const defaultProfile = profiles.some((profile) => profile.username === value.default)
    ? value.default
    : (profiles[0]?.username ?? '');
  return { default: defaultProfile, profiles };
}

function parseProfile(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.username !== 'string' || value.username.length === 0) return null;
  if (!isOptionalString(value.registry) || !isOptionalString(value.avatarUrl)) return null;
  if (value.ciPreferences !== undefined && !isRecord(value.ciPreferences)) return null;
  const authStatus =
    value.authStatus === 'authenticated' || value.authStatus === 'unauthenticated'
      ? value.authStatus
      : undefined;
  return {
    username: value.username,
    registry: value.registry,
    avatarUrl: value.avatarUrl,
    ciPreferences: value.ciPreferences,
    authStatus,
  };
}

function parseWorkspacesConfig(value: unknown): WorkspacesConfig | null {
  if (!isRecord(value) || !Array.isArray(value.paths)) return null;
  const paths: WorkspaceEntry[] = [];
  const roots = new Set<string>();
  for (const entry of value.paths) {
    const parsed = parseWorkspaceEntry(entry);
    if (!parsed) return null;
    if (roots.has(parsed.path)) return null;
    roots.add(parsed.path);
    paths.push(parsed);
  }
  return { paths };
}

function parseWorkspaceEntry(value: unknown): WorkspaceEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value.path !== 'string' || value.path.length === 0 || !path.isAbsolute(value.path)) return null;
  if (typeof value.pinned !== 'boolean') return null;
  if (typeof value.addedAt !== 'number' || !Number.isInteger(value.addedAt) || value.addedAt < 0) return null;
  return { path: value.path, pinned: value.pinned, addedAt: value.addedAt };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
