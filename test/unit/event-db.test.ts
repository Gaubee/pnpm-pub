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
  queryHistoryGroups,
  recentEvents,
} from "../../src/daemon/event-db.js";
import type { PubEvent } from "../../src/shared/index.js";
import type { Database as DatabaseType } from "../../src/daemon/db.js";

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

function insertCorruptPayloadRow(
  db: DatabaseType,
  {
    id,
    createdAt,
    groupId,
  }: {
    id: string;
    createdAt: number;
    groupId?: string;
  },
): void {
  db.prepare(
    `INSERT INTO events (
      id,
      kind,
      status,
      profile,
      profile_override,
      created_at,
      resolved_at,
      payload,
      result,
      clock_drift_recovered,
      group_id,
      tarball_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "publish",
    "success",
    "alice",
    null,
    createdAt,
    createdAt + 1,
    JSON.stringify({
      kind: "publish",
      data: {
        source: { kind: "directory", path: "/broken" },
        args: [],
        target: { name: "@scope/broken" },
      },
    }),
    "published",
    null,
    groupId ?? null,
    null,
  );
}

function insertLegacyStatusRow(
  db: DatabaseType,
  {
    id,
    createdAt,
    status,
    groupId,
  }: {
    id: string;
    createdAt: number;
    status: string;
    groupId?: string;
  },
): void {
  db.prepare(
    `INSERT INTO events (
      id,
      kind,
      status,
      profile,
      profile_override,
      created_at,
      resolved_at,
      payload,
      result,
      clock_drift_recovered,
      group_id,
      tarball_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    "configure-trust",
    status,
    "alice",
    null,
    createdAt,
    createdAt + 1,
    JSON.stringify({
      kind: "configure-trust",
      data: {
        action: "update",
        target: { name: "@scope/legacy" },
        config: {
          type: "github",
          permissions: ["createPackage"],
          claims: {
            repository: "scope/repo",
            workflow_ref: { file: ".github/workflows/release.yml" },
          },
        },
      },
    }),
    `legacy ${status}`,
    null,
    groupId ?? null,
    null,
  );
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

  describe("Feature: grouped history pagination", () => {
    it("Scenario: groupId siblings collapse into one counted history group", () => {
      insertEvent(
        db,
        makeEvent({ id: "g1-a", groupId: "grp-1", createdAt: 1001, status: "success" }),
      );
      insertEvent(
        db,
        makeEvent({ id: "g1-b", groupId: "grp-1", createdAt: 1002, status: "failed" }),
      );
      insertEvent(db, makeEvent({ id: "solo", createdAt: 1003, status: "success" }));

      const page = queryHistoryGroups(db, { page: 0, limit: 10 });

      expect(page.totalGroups).toBe(2);
      expect(page.groups).toHaveLength(2);
      expect(page.groups[0]!.id).toBe("solo");
      expect(page.groups[0]!.events.map((e) => e.id)).toEqual(["solo"]);
      expect(page.groups[1]!.id).toBe("grp-1");
      expect(page.groups[1]!.events.map((e) => e.id)).toEqual(["g1-b", "g1-a"]);
    });

    it("Scenario: a page of groups returns all members for a selected group", () => {
      insertEvent(db, makeEvent({ id: "older", createdAt: 1000, status: "success" }));
      insertEvent(
        db,
        makeEvent({ id: "batch-a", groupId: "grp-2", createdAt: 1001, status: "success" }),
      );
      insertEvent(
        db,
        makeEvent({ id: "batch-b", groupId: "grp-2", createdAt: 1002, status: "failed" }),
      );
      insertEvent(
        db,
        makeEvent({ id: "batch-c", groupId: "grp-2", createdAt: 1003, status: "success" }),
      );

      const page = queryHistoryGroups(db, { page: 0, limit: 1 });

      expect(page.totalGroups).toBe(2);
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]!.id).toBe("grp-2");
      expect(page.groups[0]!.events.map((e) => e.id)).toEqual(["batch-c", "batch-b", "batch-a"]);
    });

    it("Scenario: any pending member keeps the whole group out of history", () => {
      insertEvent(
        db,
        makeEvent({ id: "pending-a", groupId: "grp-3", createdAt: 1001, status: "pending" }),
      );
      insertEvent(
        db,
        makeEvent({ id: "done-a", groupId: "grp-3", createdAt: 1000, status: "success" }),
      );
      insertEvent(db, makeEvent({ id: "visible", createdAt: 1002, status: "success" }));

      const page = queryHistoryGroups(db, { page: 0, limit: 10 });

      expect(page.totalGroups).toBe(1);
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]!.id).toBe("visible");
    });

    it("Scenario: filters select a group once and still return its full eligible history", () => {
      insertEvent(
        db,
        makeEvent({
          id: "match-a",
          groupId: "grp-4",
          createdAt: 1001,
          status: "success",
          payload: {
            kind: "publish",
            data: {
              source: { kind: "directory", path: "/p" },
              args: [],
              target: { name: "@scope/match", version: "1.0.0", path: "/p" },
            },
          },
        }),
      );
      insertEvent(
        db,
        makeEvent({
          id: "match-b",
          groupId: "grp-4",
          createdAt: 1000,
          status: "failed",
          payload: {
            kind: "publish",
            data: {
              source: { kind: "directory", path: "/p" },
              args: [],
              target: { name: "@scope/other", version: "1.0.1", path: "/p" },
            },
          },
        }),
      );

      const page = queryHistoryGroups(db, { page: 0, limit: 10, name: "@scope/match" });

      expect(page.totalGroups).toBe(1);
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]!.id).toBe("grp-4");
      expect(page.groups[0]!.events.map((e) => e.id)).toEqual(["match-a", "match-b"]);
    });

    it("Scenario: an older corrupt payload does not poison the full grouped history page", () => {
      for (let i = 0; i < 5; i++) {
        insertEvent(db, makeEvent({ id: `good-${i}`, createdAt: 1006 - i, status: "success" }));
      }
      insertCorruptPayloadRow(db, { id: "corrupt", createdAt: 1001 });

      const preview = queryHistoryGroups(db, { page: 0, limit: 5 });
      const full = queryHistoryGroups(db, { page: 0, limit: 20 });

      expect(preview.groups).toHaveLength(5);
      expect(preview.groups.every((group) => group.id !== "corrupt")).toBe(true);
      expect(full.totalGroups).toBe(6);
      expect(full.groups).toHaveLength(6);
      expect(full.groups[5]!.id).toBe("corrupt");
      expect(full.groups[5]!.events[0]!.payload).toBeUndefined();
    });

    it("Scenario: flat history keeps a corrupt payload row but strips the unreadable payload", () => {
      insertEvent(db, makeEvent({ id: "good", createdAt: 1002, status: "success" }));
      insertCorruptPayloadRow(db, { id: "corrupt", createdAt: 1001 });

      const page = queryEvents(db, { status: "history", page: 0, limit: 10 });

      expect(page.total).toBe(2);
      expect(page.rows.map((row) => row.id)).toEqual(["good", "corrupt"]);
      expect(page.rows[1]!.payload).toBeUndefined();
    });

    it("Scenario: legacy projection statuses stay out of grouped history pages and totals", () => {
      insertEvent(db, makeEvent({ id: "good", createdAt: 1003, status: "success" }));
      insertLegacyStatusRow(db, {
        id: "legacy-a",
        createdAt: 1002,
        status: "conflict",
        groupId: "legacy-group",
      });
      insertLegacyStatusRow(db, {
        id: "legacy-b",
        createdAt: 1001,
        status: "conflict",
        groupId: "legacy-group",
      });

      const page = queryHistoryGroups(db, { page: 0, limit: 10 });

      expect(page.totalGroups).toBe(1);
      expect(page.groups).toHaveLength(1);
      expect(page.groups[0]!.id).toBe("good");
      expect(page.groups[0]!.events.map((event) => event.id)).toEqual(["good"]);
    });

    it("Scenario: flat history counts only current ontology statuses", () => {
      insertEvent(db, makeEvent({ id: "good", createdAt: 1002, status: "success" }));
      insertLegacyStatusRow(db, { id: "legacy", createdAt: 1001, status: "conflict" });

      const page = queryEvents(db, { status: "history", page: 0, limit: 10 });

      expect(page.total).toBe(1);
      expect(page.rows.map((row) => row.id)).toEqual(["good"]);
    });
  });
});
