/**
 * Runtime-portable SQLite driver abstraction.
 *
 * The daemon persists its event log + KV cache in SQLite. To run across
 * runtimes (Node / Bun / Deno) without a single native binding that some
 * runtime can't load, this module exposes a tiny SYNCHRONOUS `Database`
 * interface shaped like better-sqlite3, plus an `openDatabase()` factory that
 * picks the matching driver at runtime:
 *
 *   - Node  → `better-sqlite3`      (native, npm)
 *   - Bun   → `bun:sqlite`          (built-in; same sync run/all/get API)
 *   - Deno  → `@db/sqlite` / sqlite WASM  (jsr; sync `prepareSQL().all/.get/.run`)
 *
 * All three expose a synchronous API, so the rest of the daemon
 * (event-db.ts, store.ts, oRPC handlers) keeps its existing sync signatures —
 * no async/await cascade is needed.
 *
 * BUNDLING: the driver load is guarded by runtime checks and uses
 * `createRequire` / dynamic `import()` so the bundler never tries to inline a
 * driver meant for another runtime. `better-sqlite3` stays external (a real
 * dependency); `bun:sqlite` / Deno's sqlite resolve to the host runtime's
 * built-in.
 */
import { createRequire } from "node:module";

/** A prepared statement. Shaped to match better-sqlite3 / bun:sqlite. */
export interface Statement {
  /** Run a write; returns rows-affected + last insert rowid. */
  run(...params: unknown[]): RunResult;
  /** Return all matching rows. */
  all(...params: unknown[]): Record<string, unknown>[];
  /** Return the first matching row (or undefined). */
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/** A SQLite connection. Shaped to match better-sqlite3 / bun:sqlite. */
export interface Database {
  /** Execute one or more statements (no parameters). Used for DDL. */
  exec(sql: string): void;
  /** Set a pragma. (better-sqlite3-specific; we route to EXEC PRAGMA on Bun/Deno.) */
  pragma(pragma: string): unknown;
  /** Prepare a statement for run/all/get. */
  prepare(sql: string): Statement;
  /** Close the connection. */
  close(): void;
}

// The concrete handle we hold is always our `Database` interface; the only
// callers that need the underlying type are the adapter files below.
export type DatabaseType = Database;

/**
 * Open (or create) a SQLite database file using the current runtime's driver.
 *
 * `dbPath` must be absolute; the parent directory is created by the caller
 * (event-db.ts `openEventDb`).
 */
export function openDatabase(dbPath: string): Database {
  // Bun: built-in `bun:sqlite`, synchronous, same API shape.
  // Detected via the global Bun object. The dynamic import keeps the bundler
  // from trying to resolve `bun:sqlite` on Node.
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    return openBun(dbPath);
  }
  // Deno: `@db/sqlite` (jsr) is a WASM-backed synchronous SQLite. Detected via
  // the global Deno object. Resolved at runtime via dynamic import.
  if (typeof (globalThis as { Deno?: unknown }).Deno !== "undefined") {
    return openDeno(dbPath);
  }
  // Node (and any Node-compatible host): better-sqlite3 (native, npm).
  // `createRequire` lets us load it as a CommonJS module from an ESM context,
  // and keeps the bundler from inlining the native binding.
  return openNode(dbPath);
}

/** Node adapter — better-sqlite3. Already exposes our exact interface. */
function openNode(dbPath: string): Database {
  const require = createRequire(import.meta.url);
  // `better-sqlite3` ships as CommonJS; `require` returns the Database class.
  const DatabaseCtor = require("better-sqlite3") as new (path: string) => Database;
  return new DatabaseCtor(dbPath);
}

/** Bun adapter — `bun:sqlite`. */
function openBun(dbPath: string): Database {
  // Bun exposes a synchronous `require` for its built-ins. Using `createRequire`
  // (which Bun implements) keeps Node's bundler from statically resolving
  // `bun:sqlite` (it's not an npm package and would error on Node).
  const require = createRequire(import.meta.url);
  const { Database: BunDatabase } = require("bun:sqlite") as {
    Database: new (path: string) => BunSqliteDb;
  };
  const raw = new BunDatabase(dbPath);
  return wrapBun(raw);
}

/** Deno adapter — `@db/sqlite` (jsr) or a WASM sqlite. */
function openDeno(dbPath: string): Database {
  // Deno's jsr `@db/sqlite` exposes `new Database(path)` with prepare/all/get/run.
  // Loaded via createRequire/require interop if available, else throw with a
  // helpful message. (Deno users add `jsr:@db/sqlite` to their import map.)
  const require = createRequire(import.meta.url);
  const mod = require("@db/sqlite") as { Database: new (path: string) => DenoSqliteDb };
  const raw = new mod.Database(dbPath);
  return wrapDeno(raw);
}

// ---------------------------------------------------------------------------
// Adapter wrappers — normalize each driver's slightly-different shape to the
// common `Database` interface. Each wrapper is intentionally tiny.
// ---------------------------------------------------------------------------

// Bun's bun:sqlite Database. Its prepare().run/all/get match our interface; the
// only difference is `pragma` (bun has no `.pragma()` — route to exec).
interface BunSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
function wrapBun(raw: BunSqliteDb): Database {
  return {
    exec: (sql) => raw.exec(sql),
    // bun:sqlite has no `.pragma()` helper; `PRAGMA journal_mode=WAL` works via exec.
    pragma: (p) => {
      raw.exec(`PRAGMA ${p}`);
      return undefined;
    },
    prepare: (sql) => raw.prepare(sql),
    close: () => raw.close(),
  };
}

// Deno's @db/sqlite. Its API: db.prepareSQL(sql).run/all/get (sync). We adapt
// `prepareSQL` → `prepare`, and `exec`/`close` as available.
interface DenoSqliteDb {
  exec(sql: string): void;
  prepareSQL(sql: string): Statement;
  close(): void;
}
function wrapDeno(raw: DenoSqliteDb): Database {
  return {
    exec: (sql) => raw.exec(sql),
    pragma: (p) => {
      raw.exec(`PRAGMA ${p}`);
      return undefined;
    },
    // @db/sqlite uses prepareSQL; expose it as the common `prepare`.
    prepare: (sql) => raw.prepareSQL(sql),
    close: () => raw.close(),
  };
}
