/**
 * Event grouping — collapse flat `PubEvent[]` into `EventGroup[]` keyed by
 * `groupId`. Standalone events (no groupId) each form their own single-member
 * group with `isGroup === false` so callers can render them as plain
 * `EventCard`s without special-casing.
 *
 * Pure functions only (no runes) — shared by the store selector and both the
 * active-events and event-history pages.
 */
import type { EventStatus, PubEvent } from "./types.js";

/** Coarse category of a group, derived from its members' payload kinds. */
export type GroupKind = "trusted-publishing" | "publish" | "mixed";

export interface EventGroup {
  /** `groupId`, or the event id when standalone. */
  id: string;
  /** Aggregated category. `mixed` when the members carry different kinds. */
  kind: GroupKind;
  /** Members, newest-first. */
  events: PubEvent[];
  /** Newest member (`events[0]`). */
  latest: PubEvent;
  /** `true` only when more than one member shares this groupId. */
  isGroup: boolean;
}

/** Map a single event's payload kind onto the coarse `GroupKind` domain. */
function eventGroupKind(event: PubEvent): GroupKind {
  const kind = event.payload?.kind ?? event.kind;
  switch (kind) {
    case "configure-trust":
      return "trusted-publishing";
    case "publish":
    case "recursive-publish":
    case "create-placeholder":
      return "publish";
    default:
      return "mixed";
  }
}

/** Derive the group kind from its members. `mixed` when they disagree. */
export function deriveGroupKind(events: PubEvent[]): GroupKind {
  if (events.length === 0) return "mixed";
  const first = eventGroupKind(events[0]!);
  for (let i = 1; i < events.length; i++) {
    if (eventGroupKind(events[i]!) !== first) return "mixed";
  }
  return first;
}

/**
 * Aggregate the members' statuses into a single representative status for the
 * group badge. Priority: any pending → pending; else any failed/expired/
 * action-required → the first such; else any rejected → rejected; else success.
 */
export function aggregateGroupStatus(events: PubEvent[]): EventStatus {
  if (events.length === 0) return "success";
  let hasPending = false;
  let firstNonSuccess: EventStatus | null = null;
  for (const e of events) {
    if (e.status === "pending") hasPending = true;
    else if (e.status !== "success" && firstNonSuccess === null) firstNonSuccess = e.status;
  }
  if (hasPending) return "pending";
  if (firstNonSuccess) return firstNonSuccess;
  // No pending, no failed/expired/rejected ⇒ every member is success (the
  // empty case was handled above).
  return "success";
}

/**
 * Bucket a flat, newest-first event list into `EventGroup[]` keyed by
 * `groupId ?? event.id`. Preserves the input order (the first time a group key
 * is seen determines its position). Within a group, members stay newest-first.
 */
export function groupEvents(events: PubEvent[]): EventGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, PubEvent[]>();
  for (const e of events) {
    const key = e.groupId ?? e.id;
    const arr = byGroup.get(key);
    if (arr) arr.push(e);
    else {
      byGroup.set(key, [e]);
      order.push(key);
    }
  }
  return order.map((id) => {
    const events = byGroup.get(id)!;
    return {
      id,
      kind: deriveGroupKind(events),
      events,
      latest: events[0]!,
      isGroup: events.length > 1,
    };
  });
}
