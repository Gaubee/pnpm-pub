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

/** Coarse category of a group, derived from its members' payload kinds.
 *  `trusted-publishing` = add/update; `trusted-publishing-remove` = remove —
 *  split so the card header can use a distinct destructive (orange) identity
 *  and route the group to the removal review Dialog instead of the default
 *  trust form. */
export type GroupKind = "trusted-publishing" | "trusted-publishing-remove" | "publish" | "mixed";

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
  /** Shared workspace root when every rooted member agrees. */
  root?: string;
}

export interface EventGroupSlice {
  id: string;
  events: PubEvent[];
}

/** Runtime guard for daemon pages: grouped history slices must never be empty. */
export function hasGroupEvents(
  group: EventGroupSlice,
): group is EventGroupSlice & { events: [PubEvent, ...PubEvent[]] } {
  return group.events.length > 0;
}

/** The canonical grouping key: `groupId`, or the standalone event's own `id`. */
export function eventGroupKey(event: Pick<PubEvent, "id" | "groupId">): string {
  return event.groupId ?? event.id;
}

/** Map a single event's payload kind onto the coarse `GroupKind` domain. A
 *  `configure-trust` event with `action === "remove"` maps to its own variant
 *  so removal batches get a distinct header + review surface. */
function eventGroupKind(event: PubEvent): GroupKind {
  const payload = event.payload;
  switch (payload?.kind) {
    case "configure-trust":
      // `payload` is narrowed to the configure-trust variant here.
      return payload.data.action === "remove" ? "trusted-publishing-remove" : "trusted-publishing";
    case "publish":
    case "recursive-publish":
    case "create-placeholder":
      return "publish";
    default:
      // Fall back to the event-level kind for ungrouped/legacy events.
      switch (event.kind) {
        case "publish":
        case "recursive-publish":
        case "create-placeholder":
          return "publish";
        default:
          return "mixed";
      }
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
 * group badge. Priority: any pending → pending; else any non-success terminal
 * status → the first such; else success.
 */
export function aggregateGroupStatus(events: PubEvent[]): EventStatus {
  if (events.length === 0) return "success";
  let hasPending = false;
  let firstNonSuccess: EventStatus | null = null;
  for (const e of events) {
    if (e.status === "pending") hasPending = true;
    // `skipped` is a trusted-publishing pre-flight no-op (the desired config
    // already matched) — treat it as success-neutral so a fully-skipped batch
    // aggregates to success, not to "skipped".
    else if (e.status !== "success" && e.status !== "skipped" && firstNonSuccess === null) {
      firstNonSuccess = e.status;
    }
  }
  if (hasPending) return "pending";
  if (firstNonSuccess) return firstNonSuccess;
  // No pending and no non-success terminal status ⇒ every member is success or
  // skipped (the empty case was handled above).
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
    const key = eventGroupKey(e);
    const arr = byGroup.get(key);
    if (arr) arr.push(e);
    else {
      byGroup.set(key, [e]);
      order.push(key);
    }
  }
  return order.map((id) => materializeEventGroup({ id, events: byGroup.get(id)! }));
}

/** Project one unambiguous workspace root from the member source facts. */
export function deriveGroupRoot(events: PubEvent[]): string | undefined {
  const roots = new Set<string>();
  for (const event of events) {
    if (event.payload?.kind !== "configure-trust") continue;
    const root = event.payload.data.root?.trim();
    if (root) roots.add(root);
  }
  return roots.size === 1 ? roots.values().next().value : undefined;
}

/** Build a render-ready `EventGroup` from a server/grouped slice. */
export function materializeEventGroup(group: EventGroupSlice): EventGroup {
  return {
    id: group.id,
    kind: deriveGroupKind(group.events),
    events: group.events,
    latest: group.events[0]!,
    isGroup: group.events.length > 1,
    root: deriveGroupRoot(group.events),
  };
}
