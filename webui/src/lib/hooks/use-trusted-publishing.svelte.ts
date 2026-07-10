/**
 * Reusable Trusted Publishing status cache + fetch helpers.
 *
 * Mirrors the per-package cache that the Workspaces detail page keeps inline
 * (`trustedPublishingState` + `maybeFetchTrustedPublishing` + `onTrustedPublishingChanged`), lifted into a factory so
 * the Packages list and PackageDetail pages can share the same discipline:
 *   - 30s TTL per package (errors are cached too, to avoid retry storms),
 *   - in-flight dedup (one trustedPublishing.listTrust call per package at a time),
 *   - explicit invalidation after a config add/remove.
 *
 * Must live in a `.svelte.ts` module — it relies on Svelte 5 runes (`$state`).
 */
import { getRpcClient } from "../store.js";
import type { TrustedPublisherRegistryConfig } from "../types.js";

const TRUSTED_PUBLISHING_TTL = 30_000;

interface TrustedPublishingEntry {
  configs: TrustedPublisherRegistryConfig[];
  fetchedAt: number;
  error: boolean;
}

export type TrustedPublishingStatus = "idle" | "loading" | "ready" | "error";

/** Build a fresh per-page Trusted Publishing status store. */
export function createTrustedPublishingStatus() {
  let state = $state<Record<string, TrustedPublishingEntry>>({});
  let inFlight = $state<Set<string>>(new Set());

  function isLoading(name: string): boolean {
    return inFlight.has(name) && !state[name];
  }

  function configs(name: string): TrustedPublisherRegistryConfig[] {
    return state[name]?.configs ?? [];
  }

  function isConfigured(name: string): boolean {
    return (state[name]?.configs.length ?? 0) > 0;
  }

  function status(name: string): TrustedPublishingStatus {
    if (inFlight.has(name) && !state[name]) return "loading";
    const entry = state[name];
    if (!entry) return "idle";
    return entry.error ? "error" : "ready";
  }

  /** Fetch + cache unless fresh or already in flight. No-op on cache hit. */
  function fetch(name: string): void {
    if (inFlight.has(name)) return;
    const cached = state[name];
    if (cached && Date.now() - cached.fetchedAt < TRUSTED_PUBLISHING_TTL) return;
    inFlight = new Set(inFlight).add(name);
    const client = getRpcClient();
    if (!client) {
      state = { ...state, [name]: { configs: [], fetchedAt: Date.now(), error: true } };
      const next = new Set(inFlight);
      next.delete(name);
      inFlight = next;
      return;
    }
    client.trustedPublishing
      .listTrust({ package: name })
      .then((json) => {
        state = {
          ...state,
          [name]: {
            configs: json?.ok && json.configs ? json.configs : [],
            fetchedAt: Date.now(),
            error: !json?.ok,
          },
        };
      })
      .catch(() => {
        // Cache the failure as "no configs" for the TTL window so a flaky
        // registry doesn't trigger a retry storm on every render.
        state = { ...state, [name]: { configs: [], fetchedAt: Date.now(), error: true } };
      })
      .finally(() => {
        const next = new Set(inFlight);
        next.delete(name);
        inFlight = next;
      });
  }

  /** Drop the cached entry so the next {@link fetch} re-queries (post-mutation). */
  function invalidate(name: string): void {
    if (!name) return;
    const next = { ...state };
    delete next[name];
    state = next;
  }

  function retry(name: string): void {
    invalidate(name);
    fetch(name);
  }

  return {
    get isLoading() {
      return isLoading;
    },
    get isConfigured() {
      return isConfigured;
    },
    get configs() {
      return configs;
    },
    get status() {
      return status;
    },
    fetch,
    invalidate,
    retry,
  };
}
