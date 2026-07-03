/**
 * Tests for the SQLite event persistence layer (event-db.ts).
 *
 * Uses a temp sandbox via setHomeOverride so each test gets a fresh events.db.
 * Verifies insert/update/query round-trips, name/keyword filtering,
 * pagination + total count, orphan-pending sweep on open, and JSON/boolean
 * serialization fidelity.
 */
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { setHomeOverride, eventsDbPath } from "../../src/shared/paths.js";
import {
  openEventDb,
  insertEvent,
  updateEvent,
  queryEvents,
  recentEvents,
} from "../../src/daemon/event-db.js";
import type { PubEvent } from "../../src/shared/index.js";
import type { Database as DatabaseType } from "better-sqlite3";

const sandbox = path.join(os.tmpdir(), `pnpm-pub-eventdb-${process.pid}-${Date.now()}`);

function makeEvent(overrides: Partial<PubEvent> = {}): PubEvent {
  return {
    id: overrides.id ?? `evt-${Math.random().toString(36).slice(2)}`,
    kind: overrides.kind ?? "publish",
    status: overrides.status ?? "success",
    profile: overrides.profile ?? "alice",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}

let db: DatabaseType;

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
  db = openEventDb(eventsDbPath());
});

afterEach(() => {
  db.close();
  setHomeOverride(null);
});

describe("event-db persistence", () => {
  it("inserts and reads back an event with full fidelity", () => {
    const evt = makeEvent({
      payload: {
        kind: "publish",
        data: {
          source: { kind: "directory", path: "/p" },
          args: [],
          target: { name: "@scope/pkg", version: "1.0.0", path: "/p" },
        },
      },
      result: "Published",
      clockDriftRecovered: true,
      groupId: "grp-1",
      tarballSummary: {
        files: [{ path: "package/index.js", size: 42, mode: 420 }],
        unpackedSize: 42,
        entryCount: 1,
        bundled: [],
      },
    });
    insertEvent(db, evt);
    const got = recentEvents(db, 10);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: evt.id,
      kind: "publish",
      status: "success",
      profile: "alice",
    });
    expect(got[0]!.payload).toEqual(evt.payload);
    expect(got[0]!.tarballSummary).toEqual(evt.tarballSummary);
    expect(got[0]!.clockDriftRecovered).toBe(true);
    expect(got[0]!.groupId).toBe("grp-1");
    expect(got[0]!.result).toBe("Published");
  });

  it("updateEvent overwrites fields (resolve flow)", () => {
    const evt = makeEvent({ status: "pending" });
    insertEvent(db, evt);
    const resolved = { ...evt, status: "success" as const, resolvedAt: 999, result: "done" };
    updateEvent(db, resolved);
    const got = recentEvents(db, 10);
    expect(got).toHaveLength(1);
    expect(got[0]!.status).toBe("success");
    expect(got[0]!.resolvedAt).toBe(999);
    expect(got[0]!.result).toBe("done");
  });

  it("serializes undefined optionals as absent (not null) on readback", () => {
    const evt = makeEvent({
      profileOverride: undefined,
      resolvedAt: undefined,
      clockDriftRecovered: undefined,
    });
    insertEvent(db, evt);
    const got = recentEvents(db, 1)[0]!;
    expect(got.profileOverride).toBeUndefined();
    expect(got.resolvedAt).toBeUndefined();
    expect(got.clockDriftRecovered).toBeUndefined();
  });

  it("queryEvents paginates and reports total", () => {
    for (let i = 0; i < 25; i++) {
      insertEvent(db, makeEvent({ id: `e${i}`, createdAt: 1000 + i, status: "success" }));
    }
    const page0 = queryEvents(db, { status: "history", page: 0, limit: 10 });
    expect(page0.rows).toHaveLength(10);
    expect(page0.total).toBe(25);
    // newest-first
    expect(page0.rows[0]!.id).toBe("e24");
    const page2 = queryEvents(db, { status: "history", page: 2, limit: 10 });
    expect(page2.rows).toHaveLength(5);
    expect(page2.rows[0]!.id).toBe("e4");
  });

  it("queryEvents filters by package name (payload match)", () => {
    insertEvent(
      db,
      makeEvent({
        id: "a",
        payload: {
          kind: "publish",
          data: {
            source: { kind: "directory", path: "/p" },
            args: [],
            target: { name: "@scope/pkg", version: "1.0.0", path: "/p" },
          },
        },
      }),
    );
    insertEvent(
      db,
      makeEvent({
        id: "b",
        payload: {
          kind: "publish",
          data: {
            source: { kind: "directory", path: "/p" },
            args: [],
            target: { name: "other-lib", version: "2.0.0", path: "/p" },
          },
        },
      }),
    );
    const r = queryEvents(db, { status: "history", name: "@scope/pkg", page: 0, limit: 10 });
    expect(r.total).toBe(1);
    expect(r.rows[0]!.id).toBe("a");
  });

  it("queryEvents filters by keyword (AND match on kind/status/result)", () => {
    insertEvent(db, makeEvent({ id: "a", status: "failed", result: "OTP validation failed" }));
    insertEvent(db, makeEvent({ id: "b", status: "success", result: "Published ok" }));
    const r = queryEvents(db, {
      status: "history",
      keywords: ["failed", "otp"],
      page: 0,
      limit: 10,
    });
    expect(r.total).toBe(1);
    expect(r.rows[0]!.id).toBe("a");
  });

  it("queryEvents scope=pending excludes history and vice versa", () => {
    insertEvent(db, makeEvent({ id: "p", status: "pending" }));
    insertEvent(db, makeEvent({ id: "h", status: "success" }));
    const pending = queryEvents(db, { status: "pending", page: 0, limit: 10 });
    expect(pending.total).toBe(1);
    expect(pending.rows[0]!.id).toBe("p");
    const history = queryEvents(db, { status: "history", page: 0, limit: 10 });
    expect(history.total).toBe(1);
    expect(history.rows[0]!.id).toBe("h");
  });

  it("queryEvents filters by groupId", () => {
    insertEvent(db, makeEvent({ id: "a", groupId: "grp-1" }));
    insertEvent(db, makeEvent({ id: "b", groupId: "grp-2" }));
    const r = queryEvents(db, { groupId: "grp-1", page: 0, limit: 10 });
    expect(r.total).toBe(1);
    expect(r.rows[0]!.id).toBe("a");
  });

  it("sweeps orphan pending events to failed on open", () => {
    insertEvent(db, makeEvent({ id: "orphan", status: "pending" }));
    db.close();
    // Reopen — openEventDb sweeps pending → failed.
    db = openEventDb(eventsDbPath());
    const r = queryEvents(db, { status: "pending", page: 0, limit: 10 });
    expect(r.total).toBe(0);
    const failed = queryEvents(db, { status: "history", page: 0, limit: 10 });
    expect(failed.total).toBe(1);
    expect(failed.rows[0]!.status).toBe("failed");
    expect(failed.rows[0]!.result).toContain("Daemon restarted");
  });
});
