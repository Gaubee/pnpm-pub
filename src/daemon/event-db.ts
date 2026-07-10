/**
 * SQLite-backed event persistence.
 *
 * The event log is a live activity feed plus an audit trail. This module owns
 * all DB interaction so DaemonStore stays a thin coordinator. The driver is
 * runtime-portable (Node/Bun/Deno) via `./db.ts`; the API stays synchronous, so
 * createEvent/resolveEvent keep their sync signatures and callers need no
 * changes.
 *
 * Nested/variable fields (payload, tarballSummary) are stored as JSON TEXT;
 * flat fields map to native columns for indexing/querying. WAL mode keeps
 * reads non-blocking while writes land.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database as DatabaseType } from "./db.js";
import { openDatabase } from "./db.js";
import type { EventKind, EventStatus, PubEvent } from "../shared/index.js";
import { z } from "zod";
import {
  EventPayloadSchema,
  PubEventSchema,
  RemovalDecisionsSchema,
  TarballSummarySchema,
  TrustedPublisherRegistryConfigSchema,
} from "../shared/schemas.js";

/** Query dimensions for the paginated history endpoint. */
export interface EventQuery {
  /** 'pending' = only pending; 'history' = everything except pending. */
  status?: "pending" | "history";
  /** Package-name substring filter (matches the payload's target.name / name). */
  name?: string;
  /** Free-text keywords, AND-matched against kind|status|result|name. */
  keywords?: string[];
  /** Restrict to a single groupId (expand a collapsed group). */
  groupId?: string;
  /** Zero-based page index. */
  page: number;
  /** Page size. */
  limit: number;
}

export interface EventQueryResult {
  rows: PubEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface HistoryEventGroupRow {
  id: string;
  events: PubEvent[];
}

export interface HistoryEventGroupQuery {
  /** Package-name substring filter (matches the payload's target.name / name). */
  name?: string;
  /** Free-text keywords, AND-matched against kind|status|result|name. */
  keywords?: string[];
  /** Zero-based page index. */
  page: number;
  /** Page size in number of groups. */
  limit: number;
}

export interface HistoryEventGroupQueryResult {
  groups: HistoryEventGroupRow[];
  totalGroups: number;
  page: number;
  limit: number;
}

/**
 * Persisted history rows must stay inside the current EventStatus ontology.
 * Older builds leaked transient webui-only labels such as `conflict` into the
 * DB; they are legacy projection residue and must not participate in history
 * pagination or group materialization.
 */
const HISTORY_STATUSES = [
  "success",
  "failed",
  "expired",
  "action-required",
  "rejected",
  "canceled",
  "skipped",
] as const;
const HISTORY_STATUS_SQL = HISTORY_STATUSES.map((status) => `'${status}'`).join(", ");

// Column order matches the INSERT below.
const COLUMNS = [
  "id",
  "kind",
  "status",
  "profile",
  "profile_override",
  "created_at",
  "resolved_at",
  "payload",
  "result",
  "clock_drift_recovered",
  "group_id",
  "removal_snapshot",
  "removal_decisions",
  "tarball_summary",
  "tarball_summaries",
] as const;

/** Open (or create) the events database, set up schema, sweep orphan pendings. */
export function openEventDb(dbPath: string): DatabaseType {
  // The driver does not create the parent directory; ensure it exists.
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      profile TEXT NOT NULL,
      profile_override TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      payload TEXT,
      result TEXT,
      clock_drift_recovered INTEGER,
      group_id TEXT,
      removal_snapshot TEXT,
      removal_decisions TEXT,
      tarball_summary TEXT,
      tarball_summaries TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_group_id ON events(group_id);
    CREATE INDEX IF NOT EXISTS idx_events_group_key_created_at
      ON events(COALESCE(group_id, id), created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    -- Generic TTL cache table for derived/resolved values (e.g. repo-info
    -- parsing). Rows expire via expires_at; swept at startup and on writes.
    CREATE TABLE IF NOT EXISTS key_value (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_key_value_expires_at ON key_value(expires_at);
  `);
  // Idempotent column additions for schema evolution (no migration framework):
  // adding a column that already exists throws, so swallow that one error.
  try {
    db.exec(`ALTER TABLE events ADD COLUMN tarball_summaries TEXT`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(msg)) throw error;
  }
  try {
    db.exec(`ALTER TABLE events ADD COLUMN removal_snapshot TEXT`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(msg)) throw error;
  }
  try {
    db.exec(`ALTER TABLE events ADD COLUMN removal_decisions TEXT`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(msg)) throw error;
  }
  // On restart, any event still 'pending' has no live scheduler client handle —
  // mark it canceled so the UI doesn't show a forever-pending ghost.
  const swept = db
    .prepare(
      `UPDATE events SET status = 'canceled', result = 'Daemon restarted before the task completed.', resolved_at = ? WHERE status = 'pending'`,
    )
    .run(Date.now());
  void swept; // informational only
  // Sweep expired cache rows on startup.
  kvSweepExpired(db);
  return db;
}

// --- generic TTL key-value cache -------------------------------------------

/** Look up a cached value by key. Returns undefined when missing or expired
 *  (expired rows are lazily deleted on read). */
export function kvGet(db: DatabaseType, key: string): unknown {
  const row = db.prepare(`SELECT value, expires_at FROM key_value WHERE key = ?`).get(key) as
    | { value: string; expires_at: number }
    | undefined;
  if (!row) return undefined;
  if (row.expires_at <= Date.now()) {
    db.prepare(`DELETE FROM key_value WHERE key = ?`).run(key);
    return undefined;
  }
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

/** Store a value with a TTL (ms from now). Upserts by key. */
export function kvSet(db: DatabaseType, key: string, value: unknown, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  db.prepare(`INSERT OR REPLACE INTO key_value (key, value, expires_at) VALUES (?, ?, ?)`).run(
    key,
    JSON.stringify(value),
    expiresAt,
  );
}

/** Delete all rows past their expiry. Called at startup and opportunistically. */
export function kvSweepExpired(db: DatabaseType): number {
  const res = db.prepare(`DELETE FROM key_value WHERE expires_at <= ?`).run(Date.now());
  return res.changes;
}

/** Insert or fully replace an event row (upsert by id). */
export function insertEvent(db: DatabaseType, evt: PubEvent): void {
  db.prepare(
    `INSERT OR REPLACE INTO events (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`,
  ).run(...serializeRow(evt));
}

/** Update an existing event row by id (used by resolveEvent). */
export function updateEvent(db: DatabaseType, evt: PubEvent): void {
  insertEvent(db, evt); // INSERT OR REPLACE is idempotent and simpler than a partial UPDATE.
}

/** The N most recent events (newest-first). For preview / initial snapshots. */
export function recentEvents(db: DatabaseType, limit: number): PubEvent[] {
  const rows = db
    .prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as RawRow[];
  return rows.map(deserializeRow).filter((row): row is PubEvent => row !== null);
}

/** Count events matching a status scope. */
export function countByScope(db: DatabaseType, scope: "pending" | "history"): number {
  const row = (
    scope === "pending"
      ? db.prepare(`SELECT COUNT(*) AS n FROM events WHERE status = 'pending'`).get()
      : db.prepare(`SELECT COUNT(*) AS n FROM events WHERE status IN (${HISTORY_STATUS_SQL})`).get()
  ) as { n: number };
  return row.n;
}

/** Paginated, filtered query. Returns rows + total for page controls. */
export function queryEvents(db: DatabaseType, q: EventQuery): EventQueryResult {
  const { where, params } = buildEventFilters(q);

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM events ${whereClause}`).get(...params) as { n: number }
  ).n;
  const page = Math.max(0, q.page);
  const limit = Math.max(1, q.limit);
  const offset = page * limit;
  const rows = db
    .prepare(`SELECT * FROM events ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as RawRow[];
  return {
    rows: rows.map(deserializeRow).filter((row): row is PubEvent => row !== null),
    total,
    page,
    limit,
  };
}

/** Paginated grouped history query. Groups are keyed by `group_id ?? id`. */
export function queryHistoryGroups(
  db: DatabaseType,
  q: HistoryEventGroupQuery,
): HistoryEventGroupQueryResult {
  const page = Math.max(0, q.page);
  const limit = Math.max(1, q.limit);
  const offset = page * limit;

  const matched = buildHistoryMatchedGroups(q);
  const totalGroups = (
    db
      .prepare(`
      WITH ${matched.sql}
      SELECT COUNT(*) AS n FROM matched_groups
    `)
      .get(...matched.params) as { n: number }
  ).n;

  const groupRows = db
    .prepare(`
      WITH ${matched.sql}
      SELECT group_key, latest_created_at
      FROM matched_groups
      ORDER BY latest_created_at DESC, group_key DESC
      LIMIT ? OFFSET ?
    `)
    .all(...matched.params, limit, offset) as Array<{
    group_key: string;
    latest_created_at: number;
  }>;

  if (groupRows.length === 0) {
    return { groups: [], totalGroups, page, limit };
  }

  const groupOrder = groupRows.map((row) => row.group_key);
  const placeholders = groupOrder.map(() => "?").join(", ");
  const members = db
    .prepare(`
      SELECT *
      FROM events
      WHERE status IN (${HISTORY_STATUS_SQL})
        AND COALESCE(group_id, id) IN (${placeholders})
      ORDER BY created_at DESC, id DESC
    `)
    .all(...groupOrder) as unknown as RawRow[];

  const membersByGroup = new Map<string, PubEvent[]>();
  for (const row of members) {
    const event = deserializeRow(row);
    if (!event) continue;
    const key = event.groupId ?? event.id;
    const list = membersByGroup.get(key);
    if (list) list.push(event);
    else membersByGroup.set(key, [event]);
  }

  return {
    groups: groupOrder.map((id) => ({ id, events: membersByGroup.get(id) ?? [] })),
    totalGroups,
    page,
    limit,
  };
}

// --- serialization ---------------------------------------------------------

interface RawRow {
  id: string;
  kind: string;
  status: string;
  profile: string;
  profile_override: string | null;
  created_at: number;
  resolved_at: number | null;
  payload: string | null;
  result: string | null;
  clock_drift_recovered: number | null;
  group_id: string | null;
  removal_snapshot: string | null;
  removal_decisions: string | null;
  tarball_summary: string | null;
  tarball_summaries: string | null;
}

const warnedCorruptEventFields = new Set<string>();

/** Schema for the `tarballSummaries` JSON column (per-target summaries for a
 *  recursive publish). Mirrors `PubEventSchema.tarballSummaries`. */
const TarballSummariesColumnSchema = z.array(
  z.object({ name: z.string(), version: z.string(), summary: TarballSummarySchema }),
);

function serializeRow(evt: PubEvent): unknown[] {
  return [
    evt.id,
    evt.kind,
    evt.status,
    evt.profile,
    evt.profileOverride ?? null,
    evt.createdAt,
    evt.resolvedAt ?? null,
    evt.payload ? JSON.stringify(evt.payload) : null,
    evt.result ?? null,
    evt.clockDriftRecovered === undefined ? null : evt.clockDriftRecovered ? 1 : 0,
    evt.groupId ?? null,
    evt.removalSnapshot ? JSON.stringify(evt.removalSnapshot) : null,
    evt.removalDecisions ? JSON.stringify(evt.removalDecisions) : null,
    evt.tarballSummary ? JSON.stringify(evt.tarballSummary) : null,
    evt.tarballSummaries ? JSON.stringify(evt.tarballSummaries) : null,
  ];
}

function deserializeRow(r: RawRow): PubEvent | null {
  const payload = parseJsonField(r.payload, EventPayloadSchema, r.id, "payload");
  const tarballSummary = parseJsonField(
    r.tarball_summary,
    TarballSummarySchema,
    r.id,
    "tarballSummary",
  );
  const tarballSummaries = parseJsonField(
    r.tarball_summaries,
    TarballSummariesColumnSchema,
    r.id,
    "tarballSummaries",
  );
  const removalDecisions = parseJsonField(
    r.removal_decisions,
    RemovalDecisionsSchema,
    r.id,
    "removalDecisions",
  );
  const removalSnapshot = parseJsonField(
    r.removal_snapshot,
    z.array(TrustedPublisherRegistryConfigSchema),
    r.id,
    "removalSnapshot",
  );
  const parsed = PubEventSchema.safeParse({
    id: r.id,
    kind: r.kind as EventKind,
    status: r.status as EventStatus,
    profile: r.profile,
    profileOverride: r.profile_override ?? undefined,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? undefined,
    payload,
    result: r.result ?? undefined,
    clockDriftRecovered:
      r.clock_drift_recovered === null ? undefined : r.clock_drift_recovered === 1,
    groupId: r.group_id ?? undefined,
    removalSnapshot,
    removalDecisions,
    tarballSummary,
    tarballSummaries,
  });
  if (parsed.success) return parsed.data;
  warnCorruptEventField(
    r.id,
    "event",
    parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; "),
  );
  return null;
}

function parseJsonField<T>(
  raw: string | null,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  eventId: string,
  field: string,
): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    warnCorruptEventField(eventId, field, "schema mismatch");
  } catch {
    warnCorruptEventField(eventId, field, "invalid JSON");
  }
  return undefined;
}

function warnCorruptEventField(eventId: string, field: string, detail: string): void {
  const key = `${eventId}:${field}:${detail}`;
  if (warnedCorruptEventFields.has(key)) return;
  warnedCorruptEventFields.add(key);
  console.warn(`[event-db] ignoring corrupt ${field} for event ${eventId}: ${detail}`);
}

/** Escape a user string for safe embedding inside a SQL LIKE pattern. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function buildEventFilters(q: {
  status?: "pending" | "history";
  groupId?: string;
  name?: string;
  keywords?: string[];
}): {
  where: string[];
  params: unknown[];
} {
  const where: string[] = [];
  const params: unknown[] = [];

  if (q.status === "pending") {
    where.push(`status = 'pending'`);
  } else if (q.status === "history") {
    where.push(`status IN (${HISTORY_STATUS_SQL})`);
  }
  if (q.groupId) {
    where.push(`group_id = ?`);
    params.push(q.groupId);
  }
  if (q.name) {
    // The package name lives inside the JSON payload (target.name for publish,
    // name for create-placeholder). A LIKE over the JSON text is a pragmatic
    // scan for this volume; it avoids a generated column for now.
    where.push(`payload LIKE ?`);
    params.push(`%"name":"${escapeLike(q.name)}"%`);
  }
  if (q.keywords && q.keywords.length > 0) {
    // AND-match each keyword against the searchable haystack. We build a
    // concatenation once per row and LIKE each keyword against it.
    const haystack = `lower(kind || ' ' || status || ' ' || COALESCE(result, '') || ' ' || COALESCE(payload, ''))`;
    for (const kw of q.keywords) {
      where.push(`${haystack} LIKE ?`);
      params.push(`%${escapeLike(kw.toLowerCase())}%`);
    }
  }

  return { where, params };
}

function buildHistoryMatchedGroups(q: Pick<HistoryEventGroupQuery, "name" | "keywords">): {
  sql: string;
  params: unknown[];
} {
  const matchedFilters = buildEventFilters({
    status: "history",
    ...(q.name ? { name: q.name } : {}),
    ...(q.keywords?.length ? { keywords: q.keywords } : {}),
  });
  const matchedWhere =
    matchedFilters.where.length > 0 ? `WHERE ${matchedFilters.where.join(" AND ")}` : "";

  return {
    sql: `
      matched_rows AS (
        SELECT
          COALESCE(group_id, id) AS group_key,
          created_at
        FROM events
        ${matchedWhere}
      ),
      blocked_groups AS (
        SELECT DISTINCT group_id AS group_key
        FROM events
        WHERE status = 'pending' AND group_id IS NOT NULL
      ),
      matched_groups AS (
        SELECT
          mr.group_key,
          MAX(mr.created_at) AS latest_created_at
        FROM matched_rows AS mr
        LEFT JOIN blocked_groups AS bg ON bg.group_key = mr.group_key
        WHERE bg.group_key IS NULL
        GROUP BY mr.group_key
      )
    `,
    params: matchedFilters.params,
  };
}
