/**
 * Tray host behaviors (Chapter 6.4) — built directly on the opentray public API
 * per the skill's "Tray-Launched WebView Surface" scenario card.
 *
 *   const tray = (await createTray({ menu, primaryEvent })).extend(WebviewExt);
 *   const panel = tray.createWebviewWindow({ url, ... });
 *   tray.onMenuClick(({ itemId }) => { if (itemId === OPEN_ID) panel.show(); });
 *
 * We keep the real typed handles (`EventfulTrayHandle & WebviewTrayCapability` +
 * `WebviewWindowHandle`) instead of inventing a parallel abstraction. The host
 * layering on top is purely the product behavior the skill leaves to the app:
 *   - tray primary click toggles show/hide (synced with out-of-band hides)
 *   - the window is ALWAYS kept on top (keepOnTop is permanent, not a toggle)
 *   - blur auto-hide with a live countdown, unless "keep open" (pinned) is on
 *   - the keep-open pin is persisted via the store + projected to the WebUI
 *
 * opentray 0.8 removed its broker daemon concept: the tray lifetime is now owned
 * in-process by the caller (this daemon). createWebviewWindow bootstraps ONCE
 * per session; repeated tray activations restore via show()/hide() and must NOT
 * replay startup width/height/style. So this host never re-creates the panel —
 * it toggles visibility only.
 *
 * Event semantics (verified against the opentray native runtimes):
 *   - `blur`/`focus` are reliable — emitted by the OS key-window transition
 *     (macOS NSWindowDidResignKeyNotification / Windows WM_ACTIVATE WA_INACTIVE).
 *   - Host `hide()` and the OS close (X) button do NOT emit a dedicated lifecycle
 *     event (only an incidental `blur` if the window was key). So the WebUI
 *     reports out-of-band hides via the `window-hidden` WS message, and we keep
 *     `visibility` authoritative in-memory here.
 *   - The OS close button only hides the window (orderOut/SW_HIDE); the handle
 *     stays alive and `show()` resurrects it — no re-creation needed.
 */
import type { EventfulTrayHandle, Menu, TrayIcon as OpentrayTrayIcon } from "opentray";
import type { WebviewTrayCapability, WebviewWindowHandle } from "@opentray/ext-webview";
import type { DaemonStore } from "./store.js";

/**
 * The opentray surfaces this host drives, typed against the real SDK types.
 * `EventfulTrayHandle & WebviewTrayCapability` is what `tray.extend(WebviewExt)`
 * returns; `WebviewWindowHandle` is what `createWebviewWindow` returns.
 */
export type OpentrayTray = EventfulTrayHandle & WebviewTrayCapability;

export type OpentrayWindow = WebviewWindowHandle;

/**
 * The tray icon projection shape from opentray's public app-facing type.
 * Carries OS-scoped candidates + `isTemplate` metadata.
 */
export type TrayIcon = OpentrayTrayIcon;

export interface TrayHostOptions {
  /** Tray title (kept static). */
  title?: string;
  /** Log sink for dev/test observability. */
  log?: (line: string) => void;
  /** Menu item id that opens the window (primaryEvent). */
  openItemId?: number;
  /** Menu item id for the Quit affordance. */
  quitItemId?: number;
  /** Tray menu label for the show action (window currently hidden). */
  showLabel?: string;
  /** Tray menu label for the hide action (window currently shown). */
  hideLabel?: string;
  /** Tray menu label for the Quit action. */
  quitLabel?: string;
  /** Initial native window visibility when TrayHost takes ownership. */
  initialVisible?: boolean;
  /**
   * Projected pin (keepOnTop) state — called on every state change so the host
   * can broadcast it to connected WebUI clients. `countdown` is the live 3→2→1→0
   * number while a blur auto-hide is pending, or null when idle.
   */
  onPinFrame?: (pinned: boolean, countdown: number | null) => void;
  /**
   * Invoked when the user picks the tray "Quit" menu item. The host calls this
   * (best-effort) and lets the caller tear the daemon down — TrayHost itself
   * only owns window/tray visibility, not process lifecycle.
   */
  onQuit?: () => void;
  /**
   * Override the blur auto-hide cadence (ms). The sequence is: blur → show 3 →
   * every `tickMs` decrement to 2/1/0 → after one more tick, hide. Defaults to
   * 1000ms (a 4s total sequence: 3,2,1,0 then hide).
   */
  autoHideTickMs?: number;
}

type Visibility = "hidden" | "shown";

/** Countdown value that means "hide the window now" (never rendered). */
const COUNTDOWN_HIDE = -1;
/** First countdown number shown immediately on blur. */
const COUNTDOWN_START = 3;

export class TrayHost {
  private visibility: Visibility = "hidden";
  /**
   * "Keep open" pin — when true the window ignores blur auto-hide. The window
   * is ALWAYS kept on top regardless of this flag (keepOnTop is permanent); the
   * pin only decides whether a blur starts the auto-hide countdown.
   */
  private pinned = false;
  /** Live auto-hide countdown (3→2→1→0) while pending, else null. */
  private countdown: number | null = null;
  private blurTimer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Array<() => void> = [];

  constructor(
    private store: DaemonStore,
    private tray: OpentrayTray | null,
    private window: OpentrayWindow | null,
    private opts: TrayHostOptions = {},
  ) {
    this.visibility = opts.initialVisible ? "shown" : "hidden";
    // Seed the pin from persisted preferences (Chapter 6.4). The window was
    // created with this same value at mount time, so no setStyle is needed.
    this.pinned = store.getPreferences().keepOnTop;
    this.wireUp();
    // Sync the native menu to the initial visibility (createTray ships a static
    // menu; this relabels the primary item to match the real state).
    this.pushMenu();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
  }

  private get tickMs(): number {
    return this.opts.autoHideTickMs ?? 1000;
  }

  /**
   * Run an opentray op, swallowing + logging any rejection. opentray commands
   * route through the in-process runtime binding and can reject asynchronously
   * (e.g. a native capability gap, a stale session); a window op failure must
   * NEVER crash the daemon or propagate as an unhandled rejection — the
   * IPC/HTTP/WS surfaces stay up and the WebUI remains reachable in a browser.
   */
  private safeCall(label: string, p: Promise<unknown> | undefined): void {
    if (!p) return;
    if (typeof p.catch === "function") {
      p.catch((error: unknown) => this.log(`${label} failed: ${errorToLogMessage(error)}`));
    }
  }

  /** Push the current pin/countdown frame to the WebUI (best-effort). */
  private emitPinFrame(): void {
    try {
      this.opts.onPinFrame?.(this.pinned, this.countdown);
    } catch {
      /* projection must never throw */
    }
  }

  private wireUp(): void {
    const openId = this.opts.openItemId ?? 1;
    const quitId = this.opts.quitItemId;
    // Skill scenario: tray click toggles the SAME panel handle. The Quit item
    // delegates to the caller's onQuit (process teardown lives outside the host).
    if (this.tray) {
      const off = this.tray.onMenuClick(({ itemId }) => {
        this.log(`menu click received: itemId=${itemId}`);
        if (itemId === openId) this.toggle();
        else if (quitId !== undefined && itemId === quitId) {
          this.log("quit requested");
          try {
            this.opts.onQuit?.();
          } catch (error) {
            this.log(`onQuit failed: ${errorToLogMessage(error)}`);
          }
        }
      });
      this.unsubs.push(off);
    }
    // blur auto-hide: only when unpinned. focus cancels any pending countdown.
    if (this.window) {
      const offBlur = this.window.listen("blur", () => {
        this.log("window blur");
        this.startCountdown();
      });
      this.unsubs.push(offBlur);
      const offFocus = this.window.listen("focus", () => {
        this.log("window focus");
        this.cancelCountdown();
      });
      this.unsubs.push(offFocus);
    }
  }

  /**
   * Swap the tray icon projection. Best-effort: opentray rejections are logged,
   * never thrown. Used to flip between the default mono template and the active
   * color icon as pending-event state changes.
   */
  setIcon(icon: TrayIcon | undefined): void {
    if (!icon) return;
    this.safeCall("setIcon", this.tray?.setIcon(icon));
  }

  /**
   * Start the blur auto-hide countdown (3→2→1→0→hide). No-op if pinned or a
   * countdown is already running. Every tick + the terminal hide project a pin
   * frame so the WebUI can render the live number.
   */
  private startCountdown(): void {
    if (this.pinned) return;
    if (this.countdown !== null) return; // already counting
    this.countdown = COUNTDOWN_START;
    this.emitPinFrame();
    this.blurTimer = setInterval(() => this.tick(), this.tickMs);
  }

  private tick(): void {
    if (this.countdown === null) return;
    const next = this.countdown - 1;
    if (next === COUNTDOWN_HIDE) {
      // Sequence complete: hide and reset. Keep visibility in sync so the next
      // tray click re-shows in one click. Project the cleared frame so the
      // WebUI stops rendering the countdown number.
      this.clearTimer();
      this.countdown = null;
      this.hide();
      this.emitPinFrame();
      return;
    }
    this.countdown = next;
    this.emitPinFrame();
  }

  private cancelCountdown(): void {
    if (this.countdown === null && this.blurTimer === null) return;
    this.clearTimer();
    this.countdown = null;
    this.emitPinFrame();
  }

  private clearTimer(): void {
    if (this.blurTimer !== null) {
      clearInterval(this.blurTimer);
      this.blurTimer = null;
    }
  }

  /** Restore window visibility (skill: show() restores, never re-bootstraps). */
  show(): void {
    const showP = this.window?.show();
    this.safeCall("show", showP);
    // keepOnTop is PERMANENT (the window always stays above others). Re-apply
    // on show so a freshly-resurrected window is still on top.
    this.applyKeepOnTop(showP);
    this.visibility = "shown";
    this.pushMenu();
    this.log("show");
  }

  /** Re-apply the permanent keepOnTop style, chaining after show() if needed. */
  private applyKeepOnTop(showP: Promise<unknown> | undefined): void {
    const apply = () =>
      this.safeCall("setStyle(keepOnTop)", this.window?.setStyle({ keepOnTop: true }));
    if (showP && typeof showP.then === "function") {
      showP.then(apply, () => {});
    } else {
      apply();
    }
  }

  /**
   * Build the tray menu for the current visibility. The primary item relabels
   * to the action it will perform: "Show window" when hidden, "Hide window"
   * when shown — so the user always sees what clicking does.
   */
  private buildMenu(): Menu {
    const openId = this.opts.openItemId ?? 1;
    const quitId = this.opts.quitItemId;
    const actionTitle =
      this.visibility === "shown"
        ? (this.opts.hideLabel ?? "Hide window")
        : (this.opts.showLabel ?? "Show window");
    const items: Menu["items"] = [
      { type: "item", id: openId, title: actionTitle, primaryEvent: true },
    ];
    if (quitId !== undefined) {
      items.push({ type: "separator" });
      items.push({ type: "item", id: quitId, title: this.opts.quitLabel ?? "Quit" });
    }
    return { items };
  }

  /** Push the current menu to the native tray (best-effort). */
  private pushMenu(): void {
    if (!this.tray) return;
    this.safeCall("setMenu", this.tray.setMenu(this.buildMenu()));
  }

  /** Primary tray click behavior for a tray-owned panel. */
  toggle(): void {
    if (this.visibility === "hidden") this.show();
    else this.hide();
  }

  /** Reversible dismissal (skill: hide(), NOT destroy()). */
  hide(): void {
    this.safeCall("hide", this.window?.hide());
    this.visibility = "hidden";
    this.pushMenu();
    this.log("hide");
  }

  /**
   * Mark the window as hidden out-of-band (OS close X / host hide that this
   * process didn't initiate). The WebUI reports these via the `window-hidden`
   * WS message because opentray emits no dedicated lifecycle event for them.
   * Idempotent. This keeps `toggle()` correct so the next tray click re-shows
   * in a single click instead of two.
   */
  markHidden(): void {
    this.cancelCountdown();
    this.visibility = "hidden";
    this.pushMenu();
  }

  /**
   * Toggle the "keep open" pin: persist it and (when pinning) cancel any pending
   * auto-hide. The window's keepOnTop style is permanent and NOT affected by the
   * pin — the pin only gates blur auto-hide. Projected to the WebUI immediately.
   */
  async setPin(pinned: boolean): Promise<void> {
    if (this.pinned === pinned) {
      this.emitPinFrame();
      return;
    }
    this.pinned = pinned;
    // Persist (fire-and-forget; the store swallows nothing but writeJson is
    // atomic + best-effort). Awaited so callers/tests can observe completion.
    await this.store.setKeepOnTop(pinned);
    if (pinned) this.cancelCountdown();
    this.log(`keep-open pin set to ${pinned}`);
    this.emitPinFrame();
  }

  /** Current pin + live countdown (for the WebUI initial snapshot). */
  getPinState(): { pinned: boolean; countdown: number | null } {
    return { pinned: this.pinned, countdown: this.countdown };
  }

  async destroy(): Promise<void> {
    this.clearTimer();
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.unsubs = [];
    // Skill: destroy() only when the app really wants to reset the page runtime.
    try {
      await this.window?.destroy();
    } catch {
      /* ignore */
    }
    try {
      await this.tray?.destroy();
    } catch {
      /* ignore */
    }
  }

  /** Exposed for tests / observability. */
  getVisibility(): Visibility {
    return this.visibility;
  }
}

function errorToLogMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
