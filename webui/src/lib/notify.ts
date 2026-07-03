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

export type IslandTone = "info" | "success" | "error" | "warning";

export interface IslandItem {
  /** Unique id (monotonic). Stable across renders so keyed-each works. */
  id: number;
  tone: IslandTone;
  message: string;
  /** Optional lucide icon component; defaults by tone when omitted. */
  icon?: Component;
  /** Lifetime in ms. <= 0 = sticky. Default 4000. */
  durationMs?: number;
}

export interface IslandInput {
  tone: IslandTone;
  message: string;
  icon?: Component;
  durationMs?: number;
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
