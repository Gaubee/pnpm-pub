/**
 * Dynamic Island — a single "live activity" slot anchored to the titlebar.
 *
 * Modelled after iOS Dynamic Island: there is ONE active activity at a time
 * (not a notification queue). The island's interaction is fixed and generic:
 *
 *   1. Compact: a centred pill (icon + summary). Tap the centre → expand.
 *   2. Expanded: shows `detail` (text / key-value lines / progress). Tap the
 *      centre again → fire the `primaryAction`.
 *   3. inline-end icon button (always visible when a primaryAction exists):
 *      tap → fire the primaryAction directly (no expand).
 *
 * Callers only supply DATA (summary / detail / primaryAction); they never
 * describe interaction. The island is a pure, generic UI component.
 *
 * Producers:
 *   - imperative API: `showActivity(...)` from any component (pending events,
 *     downloads, …).
 *   - the daemon WS `toast` channel — bridged here as a transient, non
 *     expandable activity (auto-clears after a short lifetime).
 */
import { writable, get } from "svelte/store";
import type { Component } from "svelte";

export type IslandTone = "info" | "success" | "error" | "warning";

/**
 * Expanded-detail template. A discriminated union (pick ONE shape) — the
 * island renders the chosen layout and nothing else, so callers stay generic.
 */
export type IslandDetail =
  | { kind: "text"; text: string }
  | { kind: "progress"; progress: number; label?: string };

export interface IslandActivity {
  /** Lucide icon component for the compact/expanded leading icon. */
  icon?: Component;
  /** Compact summary text (e.g. "@scope/pkg@1.2.3"). */
  summary: string;
  /** Tone tints the icon + a subtle border. Defaults to "info". */
  tone?: IslandTone;
  /**
   * Expanded detail. Omit for a non-expandable activity (tapping the centre
   * fires `primaryAction` directly, if any).
   *   - string: shorthand → rendered as a text block.
   *   - IslandDetail: a `text` block or a `progress` bar (+ optional label).
   */
  detail?: string | IslandDetail;
  /**
   * Primary action. Fired by tapping the centre while expanded, or the
   * inline-end icon button at any time. Omit when there is nothing to "open".
   */
  primaryAction?: {
    /** Lucide icon shown in the inline-end button (required). */
    icon: Component;
    /** a11y label / tooltip. */
    label?: string;
    run: () => void | Promise<void>;
  };
  /**
   * Auto-clear after N ms. <= 0 / omitted = sticky (caller owns lifetime).
   * Transient activities (daemon toasts, download-done) set this.
   */
  durationMs?: number;
}

/** The single active activity (null = island hidden). */
export const activity = writable<(IslandActivity & { id: number }) | null>(null);

/** Monotonic id so callers can target exactly what they showed. */
let nextId = 1;
let currentTimer: ReturnType<typeof setTimeout> | null = null;

function clearCurrentTimer(): void {
  if (currentTimer !== null) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
}

/**
 * A coarse signature of an activity's observable content (ignoring `id` and
 * `durationMs`). Used to make `showActivity` idempotent: re-showing the same
 * content is a no-op (keeps the existing id), so reactive callers that re-run
 * on every dependency change don't loop.
 */
function signature(a: IslandActivity): string {
  const pa = a.primaryAction;
  const d = a.detail;
  const detailSig =
    d === undefined
      ? ""
      : typeof d === "string"
        ? `s:${d}`
        : d.kind === "text"
          ? `t:${d.text}`
          : `p:${d.progress}:${d.label ?? ""}`;
  return [a.icon, a.summary, a.tone ?? "", detailSig, pa ? "1" : "0", pa?.label ?? ""].join("|");
}

/**
 * Set the active activity (replaces any current one — single slot). Returns
 * the activity id (for targeted `clearActivity`). Idempotent: if the current
 * activity has the same observable content, nothing changes and the existing
 * id is returned (no store emit, so reactive callers don't loop). Honours
 * `durationMs`: a positive value auto-clears after the delay.
 */
export function showActivity(input: IslandActivity): number {
  const prev = get(activity);
  if (prev && signature(prev) === signature(input)) {
    return prev.id;
  }
  clearCurrentTimer();
  const id = nextId++;
  activity.set({ id, ...input });
  const ms = input.durationMs ?? 0;
  if (ms > 0) {
    currentTimer = setTimeout(() => {
      currentTimer = null;
      clearActivity(id);
    }, ms);
  }
  return id;
}

/**
 * Clear the active activity. With an `id`, only clears when it still matches
 * (so a newer activity isn't wiped by a stale timer). Without `id`, always
 * clears.
 */
export function clearActivity(id?: number): void {
  clearCurrentTimer();
  if (id === undefined) {
    activity.set(null);
    return;
  }
  activity.update((a) => (a && a.id === id ? null : a));
}

/**
 * Bridge the daemon `toast` channel into the island as a transient,
 * non-expandable activity. Idempotent by the toast `id` (repeated broadcasts
 * of the same frame don't re-trigger).
 */
let lastToastId = 0;
export function bridgeDaemonToast(
  toast: { level: IslandTone; message: string; id: number } | null,
): void {
  if (!toast || toast.id === lastToastId) return;
  lastToastId = toast.id;
  showActivity({
    summary: toast.message,
    tone: toast.level,
    durationMs: 4000,
  });
}
