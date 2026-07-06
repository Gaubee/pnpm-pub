/**
 * Dynamic Island — the global notification surface anchored to the titlebar.
 *
 * Two producers feed a single `island` store:
 *   1. imperative API: `notify({ tone, message, icon?, durationMs? })` from any
 *      component (cross-page custom messages).
 *   2. the daemon WS `toast` channel — bridged here so existing daemon-side
 *      toasts (auth result, errors, pending-event created, …) surface in the
 *      island instead of the legacy <Toaster>.
 *
 * Each item carries its own lifetime: `durationMs <= 0` is sticky (stays until
 * explicitly dismissed), otherwise it auto-dismisses when the timer elapses.
 */
import { writable } from "svelte/store";
import type { Component } from "svelte";
import type { EventKind } from "./types.js";

export type IslandTone = "info" | "success" | "error" | "warning";

/**
 * An optional action button rendered inside the notification item (e.g. "Open
 * file" after a download). `run` is a client-side callback — the island is a
 * pure UI surface, so actions are closures the caller supplies (typically
 * calling a store action like `actions.openPath`). Clicking the action also
 * dismisses the item.
 */
export interface IslandAction {
  /** Button label (already i18n-resolved by the caller). */
  label: string;
  /** Optional lucide icon component for the button. */
  icon?: Component;
  run: () => void | Promise<void>;
}

export interface IslandItem {
  /** Unique id (monotonic). Stable across renders so keyed-each works. */
  id: number;
  tone: IslandTone;
  message: string;
  /** Optional lucide icon component; defaults by tone when omitted. */
  icon?: Component;
  /** Lifetime in ms. <= 0 = sticky. Default 4000. */
  durationMs?: number;
  /** Optional inline action button. */
  action?: IslandAction;
  /**
   * Associated PubEvent id — when set, this item represents a live pending
   * event and is clickable to scroll to that event's card on the
   * /active-events page. Persisted (sticky) until the event resolves.
   */
  eventId?: string;
  /**
   * Associated batch groupId — when the event is a member of a multi-package
   * group, scrolling targets the group (g.id === groupId). Falls back to
   * `eventId` for standalone events (g.id === event.id).
   */
  groupId?: string;
  /** The EventKind, used to pick a tone/icon and render a summary label. */
  kind?: EventKind;
}

export interface IslandInput {
  tone: IslandTone;
  message: string;
  icon?: Component;
  durationMs?: number;
  action?: IslandAction;
  /** See {@link IslandItem.eventId}. */
  eventId?: string;
  /** See {@link IslandItem.groupId}. */
  groupId?: string;
  /** See {@link IslandItem.kind}. */
  kind?: EventKind;
}

export const island = writable<IslandItem[]>([]);

/** Monotonic id source. Toast ids from the daemon are Date.now()-based and can
 *  collide; we namespace island ids above that range to stay unique. */
let nextId = 1;

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function arm(item: IslandItem): void {
  if ((item.durationMs ?? 4000) <= 0) return; // sticky
  const ms = item.durationMs ?? 4000;
  timers.set(
    item.id,
    setTimeout(() => dismiss(item.id), ms),
  );
}

/** Push a message into the island. Returns the item id (for manual dismiss). */
export function notify(input: IslandInput): number {
  const id = nextId++;
  const item: IslandItem = { id, ...input };
  island.update((items) => [item, ...items]);
  arm(item);
  return id;
}

/** Remove one item by id (cancels its auto-dismiss timer). */
export function dismiss(id: number): void {
  clearTimer(id);
  island.update((items) => items.filter((i) => i.id !== id));
}

/**
 * Push a live pending event into the island. Sticky by default (stays until
 * the event resolves and the caller invokes {@link dismissByEventId} /
 * {@link dismissByGroupId}). Carries the event/group id so the island item
 * can scroll to the matching card on /active-events when clicked.
 *
 * Idempotent by `eventId`: re-pushing the same event id is a no-op (the
 * pending-event sync in the layout may fire repeatedly; this guards it).
 */
export function notifyPendingEvent(input: {
  id: string;
  groupId?: string;
  kind?: EventKind;
  tone?: IslandTone;
  message: string;
}): number {
  const existing = getIsland().find((i) => i.eventId === input.id);
  if (existing) return existing.id;
  const id = nextId++;
  const item: IslandItem = {
    id,
    tone: input.tone ?? "info",
    message: input.message,
    durationMs: 0, // sticky — owned by the event lifecycle
    eventId: input.id,
    groupId: input.groupId,
    kind: input.kind,
  };
  island.update((items) => [item, ...items]);
  // arm() skips sticky items; no timer.
  return id;
}

/** Remove the pending-event item matching `eventId` (no-op if absent). */
export function dismissByEventId(eventId: string): void {
  const match = getIsland().find((i) => i.eventId === eventId);
  if (match) dismiss(match.id);
}

/**
 * Remove every pending-event item whose `groupId` matches. Used when a whole
 * batch resolves. Standalone items (no groupId) are left untouched.
 */
export function dismissByGroupId(groupId: string): void {
  for (const i of getIsland()) {
    if (i.groupId === groupId) dismiss(i.id);
  }
}

/** Snapshot helper for idempotency checks outside the reactive store. */
function getIsland(): IslandItem[] {
  let snapshot: IslandItem[] = [];
  island.subscribe((v) => (snapshot = v))(); // subscribe + immediately unsubscribe
  return snapshot;
}

/** Clear everything (e.g. on route change if desired). */
export function clearIsland(): void {
  for (const id of [...timers.keys()]) clearTimer(id);
  island.set([]);
}

/**
 * Bridge the daemon `toast` channel into the island. Idempotent: pass the
 * incoming toast (with its `id`); it only pushes when the id changes (so a
 * repeated broadcast of the same toast frame doesn't double up).
 *
 * "Authenticated." is intentionally kept — it's the connection-lifecycle toast
 * and currently serves as a test sample for the island.
 */
let lastToastId = 0;
export function bridgeDaemonToast(
  toast: { level: IslandTone; message: string; id: number } | null,
): void {
  if (!toast || toast.id === lastToastId) return;
  lastToastId = toast.id;
  notify({ tone: toast.level, message: toast.message });
}

/**
 * Event-focus request channel — a decoupled way for the Dynamic Island (or any
 * caller) to ask an event list/card to focus a SPECIFIC member event.
 *
 * The island pushes a focus request here when a pending-event item is clicked;
 * the GroupEventCard / active-events page observe this store and, when the
 * `eventId` belongs to one of their rendered members, expand the accordion and
 * scroll the matching row into view. `nonce` ensures a fresh request is
 * detectable even if the same eventId is requested twice in a row.
 */
export interface EventFocusRequest {
  eventId: string;
  nonce: number;
}
export const eventFocus = writable<EventFocusRequest | null>(null);

let focusNonce = 0;
/** Request that the list focus (expand + scroll to) the given member event. */
export function focusEvent(eventId: string): void {
  eventFocus.set({ eventId, nonce: ++focusNonce });
}
