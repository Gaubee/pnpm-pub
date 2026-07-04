/**
 * Global daemon connection — a long-lived WebSocket client carrying the
 * WebToken (Chapter 3.2.2 / 4.4.3).
 *
 * The store exposes reactive Svelte state for profiles / workspaces / events
 * and helper methods for every action verb in the protocol. The WebToken is
 * injected via the URL hash by the opentray host (Chapter 3.2.2 安全分发).
 */
import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { consumeEventIterator } from "@orpc/client";
import type {
  WsServerMessage,
  PubEvent,
  Profile,
  WorkspaceEntry,
  PublishTarget,
  EventKind,
  EventPayloadData,
} from "./types";
import type { RepoInfo } from "./components/repo-info-types.js";
import { filterVisibleEvents, sortEvents } from "./event-projection.js";
import { createWebRpcClient, type WebRpcClient } from "./orpc-client.js";

/**
 * Read the WebUI auth token. On first load the token arrives in the URL hash
 * (`#token=HEX`). We immediately persist it to sessionStorage and clear the
 * hash so SPA route navigation never loses it (SvelteKit's hash handling
 * would otherwise swallow it). Subsequent reads come from sessionStorage.
 */
const SESSION_TOKEN_KEY = "pnpm-pub-webtoken";

function captureTokenFromHash(): void {
  if (!browser) return;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    // Clear the hash so SvelteKit router doesn't fight with it.
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

/** Read the bearer used to open the authenticated oRPC WebSocket. */
export function readWebToken(): string {
  if (!browser) return "";
  captureTokenFromHash(); // idempotent — only captures if hash is present
  return sessionStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

/**
 * The avatar URL for a saved profile, served from the daemon's PNG cache via
 * `/api/avatar/:username.png`. The daemon resolves/caches the npm avatar on its
 * side; the WebUI never hits the npm/gravatar network directly. The WebToken is
 * appended as `?token=` because <img src> can't set Authorization headers. The
 * route waits for (or triggers) the in-flight fetch if the cache is cold.
 */
export function avatarUrlFor(username: string): string {
  const token = readWebToken();
  const t = encodeURIComponent(username);
  return `/api/avatar/${t}.png${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

function derivePort(): string {
  if (!browser) return "0";
  // The daemon serves on a random port; opentray loads /#token=... on whatever
  // port it was told. We just use the current window location.
  return window.location.port || (window.location.protocol === "https:" ? "443" : "80");
}

export interface DaemonState {
  connected: boolean;
  authed: boolean;
  /**
   * True after the daemon has sent the authoritative profiles frame. Transport
   * connection is only a projection; route gates must wait for this source.
   */
  profilesLoaded: boolean;
  profiles: Profile[];
  defaultProfile: string;
  workspaces: WorkspaceEntry[];
  events: PubEvent[];
  packages: PublishTarget[];
  scannedRoot: string | null;
  /** True when the scanned root is a pnpm workspace (pnpm-workspace.yaml). */
  isPnpmWorkspace: boolean;
  /** Staged confirmation token for a risky-workspace add (Chapter 5.3.2). */
  riskyConfirmationToken: string | null;
  /**
   * Tray window keepOnTop pin state (Chapter 6.4). When true the window stays
   * on top and is exempt from blur auto-hide. `exitRequested`, `windowVisibility`,
   * and `hasActiveEvents` are daemon facts; `pinCountdown` is a local projection
   * derived from the page-owned WebAnimation auto-close timeline.
   */
  pinned: boolean;
  exitRequested: boolean;
  windowVisibility: "hidden" | "shown";
  hasActiveEvents: boolean;
  pinCountdown: number | null;
  toast: { level: "info" | "success" | "error" | "warning"; message: string; id: number } | null;
}

function createState(): DaemonState {
  return {
    connected: false,
    authed: false,
    profilesLoaded: false,
    profiles: [],
    defaultProfile: "",
    workspaces: [],
    events: [],
    packages: [],
    scannedRoot: null,
    isPnpmWorkspace: false,
    riskyConfirmationToken: null,
    pinned: false,
    exitRequested: false,
    windowVisibility: "hidden",
    hasActiveEvents: false,
    pinCountdown: null,
    toast: null,
  };
}

export const daemon = writable<DaemonState>(createState());

/**
 * Ephemeral UI state — NOT protocol data. Drives the global Add Profile dialog
 * (used when at least one profile exists and the user adds another). When there
 * are NO profiles, the app forces the dedicated `/add-profile` route instead.
 */
export const ui = writable<{ addProfileOpen: boolean }>({ addProfileOpen: false });

export function openAddProfile(): void {
  ui.set({ addProfileOpen: true });
}

export function closeAddProfile(force = false): void {
  if (!force) {
    const { profiles } = get(daemon);
    if (profiles.length === 0) return;
  }
  ui.set({ addProfileOpen: false });
}

let socket: WebSocket | null = null;
let rpc: WebRpcClient | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stopStateSubscription: (() => Promise<void>) | null = null;

/** Open (or reopen) the daemon WebSocket and authenticate with the WebToken. */
export function connect(): void {
  if (!browser) return;
  installHideReporter();
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  const token = readWebToken();
  const port = derivePort();
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${window.location.hostname}:${port}/ws/rpc?token=${encodeURIComponent(token)}`;
  try {
    socket = new WebSocket(url);
    rpc = createWebRpcClient(socket);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    daemon.update((s) => ({ ...s, connected: true, authed: true }));
    startStateSubscription();
  };
  socket.onclose = () => {
    void stopStateSubscription?.();
    stopStateSubscription = null;
    daemon.update((s) => ({ ...s, connected: false, authed: false }));
    socket = null;
    rpc = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}

export function getRpcClient(): WebRpcClient | null {
  return rpc;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 1500);
}

function startStateSubscription(): void {
  if (!rpc || stopStateSubscription) return;
  stopStateSubscription = consumeEventIterator(rpc.state.subscribe(), {
    onEvent: handleServerMessage,
    onError: () => {
      daemon.update((s) => ({ ...s, connected: false, authed: false }));
      scheduleReconnect();
    },
  });
}

/**
 * Report out-of-band window hides to the daemon. The opentray host's hide()
 * and the OS close (X) button emit NO dedicated lifecycle event, so without
 * this the TrayHost's in-memory visibility would drift out of sync and the
 * next tray click would need two presses (toggle mis-reads "shown" → hide).
 *
 * We use two complementary signals because page visibility is NOT symmetric
 * across hosts:
 *   - `visibilitychange` → 'hidden': fires reliably on Windows (WebView2 flips
 *     page visibility on SW_HIDE, incl. the WM_CLOSE→SW_HIDE X-button path).
 *     On macOS (WKWebView) `orderOut` does NOT reliably flip visibilityState,
 *     so this alone can miss a hide.
 *   - `window` blur + a short delayed re-check: a blur fires on both platforms
 *     when the window loses key/focus (incl. the X-button on macOS). After the
 *     blur we re-check `document.visibilityState` after a brief delay — if the
 *     page reports hidden, the window was dismissed (not just momentarily
 *     unfocused, which would keep visibilityState 'visible'). This catches the
 *     macOS X-close case that visibilitychange alone misses.
 *
 * The message is idempotent (the daemon no-ops an already-hidden mark), so
 * redundant signals from both paths are harmless. The listeners are installed
 * once.
 */
let hideReporterInstalled = false;
function reportHidden(): void {
  void rpc?.tray.windowHidden();
}
function installHideReporter(): void {
  if (!browser || hideReporterInstalled) return;
  hideReporterInstalled = true;
  // Primary: page visibility flip (reliable on Windows).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reportHidden();
  });
  // Supplement: on a window blur, re-check visibility shortly after. A plain
  // focus loss (clicking another app) keeps visibilityState 'visible', so the
  // re-check no-ops; an actual hide (orderOut/SW_HIDE) flips it to 'hidden'
  // and we report. This bridges the macOS X-close gap.
  window.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.visibilityState === "hidden") reportHidden();
    }, 150);
  });
}

function handleServerMessage(msg: WsServerMessage): void {
  switch (msg.type) {
    case "hello":
      // daemon requires auth; we already sent it on open.
      break;
    case "profiles":
      daemon.update((s) => ({
        ...s,
        profilesLoaded: true,
        profiles: msg.profiles,
        defaultProfile: msg.default,
      }));
      break;
    case "workspaces":
      daemon.update((s) => ({ ...s, workspaces: msg.workspaces }));
      break;
    case "events":
      daemon.update((s) => ({ ...s, events: sortEvents(msg.events) }));
      break;
    case "event":
      daemon.update((s) => {
        const others = s.events.filter((e) => e.id !== msg.event.id);
        return { ...s, events: sortEvents([msg.event, ...others]) };
      });
      break;
    case "packages":
      daemon.update((s) => ({
        ...s,
        packages: msg.packages,
        scannedRoot: msg.root,
        isPnpmWorkspace: msg.isPnpmWorkspace ?? false,
        riskyConfirmationToken: msg.riskyConfirmationToken ?? null,
      }));
      break;
    case "toast":
      daemon.update((s) => ({ ...s, toast: { ...msg, id: Date.now() } }));
      break;
    case "pin":
      daemon.update((s) => ({
        ...s,
        pinned: msg.pinned,
        exitRequested: msg.exitRequested,
        windowVisibility: msg.visibility,
        hasActiveEvents: msg.hasActiveEvents,
        pinCountdown: msg.exitRequested ? s.pinCountdown : null,
      }));
      break;
  }
}

/** Local projection from the page-owned auto-close animation timeline. */
export function setWindowAutoCloseCountdown(countdown: number | null): void {
  if (get(daemon).pinCountdown === countdown) return;
  daemon.update((s) => ({ ...s, pinCountdown: countdown }));
}

function dispatchMessages(messages: WsServerMessage[]): void {
  for (const msg of messages) handleServerMessage(msg);
}

function pushToast(level: "info" | "success" | "error" | "warning", message: string): void {
  handleServerMessage({ type: "toast", level, message });
}

// ----- Derived selectors -----

export const visibleEvents = derived(daemon, ($d) =>
  filterVisibleEvents($d.events, $d.defaultProfile),
);
export const pendingEvents = derived(visibleEvents, ($events) =>
  $events.filter((e) => e.status === "pending"),
);
export const historyEvents = derived(visibleEvents, ($events) =>
  $events.filter((e) => e.status !== "pending"),
);

/**
 * History events grouped by `groupId`. Each entry is either a standalone
 * event (no groupId) or a collapsed group (latest first, "+N more" hidden).
 * `events` is sorted newest-first within a group; `latest` is events[0].
 */
export interface HistoryGroup {
  id: string; // groupId, or the event id when standalone
  latest: PubEvent;
  events: PubEvent[]; // newest-first
  collapsed: boolean; // true when more than one member
}
export const groupedHistoryEvents = derived(historyEvents, ($events): HistoryGroup[] => {
  // historyEvents is already newest-first. Preserve that order.
  const byGroup = new Map<string, PubEvent[]>();
  for (const e of $events) {
    const key = e.groupId ?? e.id;
    const arr = byGroup.get(key);
    if (arr) arr.push(e);
    else byGroup.set(key, [e]);
  }
  return [...byGroup.values()].map((events) => ({
    id: events[0]!.groupId ?? events[0]!.id,
    latest: events[0]!,
    events,
    collapsed: events.length > 1,
  }));
});
export const activeProfile = derived(
  daemon,
  ($d) => $d.profiles.find((p) => p.username === $d.defaultProfile) ?? null,
);

// ----- Action helpers (Chapter 6.2 / 6.3) -----

export const actions = {
  selectProfile(username: string): void {
    // Chapter 6.1.1: switching identity clears the client store and
    // re-fetches the target profile's data so workspaces/packages are
    // re-scoped (profile isolation). A pending CLI profile override can
    // still surface through the visible-events projection.
    daemon.update((s) => ({
      ...s,
      defaultProfile: username,
      workspaces: [],
      packages: [],
      scannedRoot: null,
      riskyConfirmationToken: null,
    }));
    void rpc?.profile.select({ username }).then((res) => {
      if (!res.ok && res.error) pushToast("error", res.error);
    });
  },
  async deleteProfile(username: string): Promise<boolean> {
    const res = await rpc?.profile.delete({ username });
    return res?.ok ?? false;
  },
  confirm(id: string): void {
    void rpc?.events.confirm({ id }).then((res) => {
      if (!res.ok && res.error) pushToast("error", res.error);
    });
  },
  reject(id: string): void {
    void rpc?.events.reject({ id }).then((res) => {
      if (!res.ok && res.error) pushToast("error", res.error);
    });
  },
  /** Edit a pending publish event's CLI args before confirmation. The daemon
   *  mutates the event in place and re-broadcasts it; the scheduler re-reads
   *  args live at confirm time, so the edit takes effect on the next confirm. */
  updateEvent(id: string, args: string[]): void {
    void rpc?.events.update({ id, args }).then((res) => {
      if (!res.ok && res.error) pushToast("error", res.error);
    });
  },
  /**
   * Toggle the tray window's keep-open pin (Chapter 6.4). The daemon persists
   * it, re-evaluates auto-close eligibility, and projects the new frame back
   * via the `pin` server message.
   */
  setPin(pinned: boolean): void {
    void rpc?.tray.setPin({ pinned });
  },
  /** Called when the page-owned WAAPI exit timeline has actually completed. */
  completeAutoClose(): void {
    void rpc?.tray.completeAutoClose();
  },
  scanWorkspace(root: string): void {
    void rpc?.workspace.scan({ root }).then((res) => dispatchMessages(res.messages));
  },
  /** Confirm a staged risky-workspace add (Chapter 5.3.2). */
  async confirmRiskyWorkspace(token: string): Promise<boolean> {
    const res = await rpc?.workspace.confirmRisky({ token });
    if (res?.ok) daemon.update((s) => ({ ...s, riskyConfirmationToken: null }));
    return res?.ok ?? false;
  },
  /** Cancel a staged risky-workspace add (Chapter 5.3.2). */
  cancelRiskyWorkspace(token: string): Promise<void> {
    daemon.update((s) => ({ ...s, riskyConfirmationToken: null }));
    return (
      rpc?.workspace.cancelRisky({ token }).then(
        () => undefined,
        () => undefined,
      ) ?? Promise.resolve()
    );
  },
  createEvent<K extends EventKind>(kind: K, payload: EventPayloadData<K>, groupId?: string): void {
    void rpc?.events
      .create({ kind, payload, ...(groupId ? { groupId } : {}) })
      .then((res) => dispatchMessages(res.messages));
  },
  /** Resolve a repository string into a display descriptor (host/shortName/
   *  browseUrl/faviconUrl/brand). Backed by the daemon's TTL cache; results are
   *  also memoized in-process here so repeated renders never re-fetch. */
  async repoInfo(repo: string): Promise<RepoInfo | null> {
    const cached = repoInfoCache.get(repo);
    if (cached) return cached;
    const promise = (async () => {
      try {
        const json = await rpc?.repo.info({ repo });
        const info = json?.ok ? ((json.info ?? null) as RepoInfo | null) : null;
        // Don't cache nulls in-process: a transient failure (401, network)
        // shouldn't poison the cache for the whole session.
        if (!info) repoInfoCache.delete(repo);
        return info;
      } catch {
        repoInfoCache.delete(repo);
        return null;
      }
    })();
    // Cache the promise itself so concurrent callers share one request.
    repoInfoCache.set(repo, promise);
    return promise;
  },
  /** Open a local directory in the OS file manager (Finder/Explorer/…). */
  async openPath(path: string): Promise<boolean> {
    try {
      const json = await rpc?.repo.openPath({ path });
      return json?.ok ?? false;
    } catch {
      return false;
    }
  },
  /** Open a URL in the OS default browser (the webview can't do this itself). */
  async openUrl(url: string): Promise<boolean> {
    try {
      const json = await rpc?.repo.openUrl({ url });
      return json?.ok ?? false;
    } catch {
      return false;
    }
  },
};

/** In-process cache of repo-info promises (keyed by raw repository string). */
const repoInfoCache = new Map<string, Promise<RepoInfo | null>>();

/** Convenience: are we waiting on any pending event? (Tray keepOnTop hint.) */
export function hasPending(): boolean {
  return get(daemon).events.some((e) => e.status === "pending");
}
