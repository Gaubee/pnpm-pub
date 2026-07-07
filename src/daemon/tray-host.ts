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
 *   - blur requests page-owned auto-close animation unless keep-open is active
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
import { WINDOW_ENTER_SEED_OPACITY } from "../shared/window-opacity.js";

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

type Visibility = "hidden" | "shown";

export interface TrayPinFrame {
  exitRequested: boolean;
  visibility: Visibility;
  hasActiveEvents: boolean;
}

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
   * Projected tray/window state — called on every state change so the host can
   * broadcast it to connected WebUI clients. The daemon owns eligibility
   * (`exitRequested`, `hasActiveEvents`, `visibility`); the WebUI owns the
   * opacity animation and its derived countdown.
   */
  onPinFrame?: (frame: TrayPinFrame) => void;
  /**
   * Invoked when the user picks the tray "Quit" menu item. The host calls this
   * (best-effort) and lets the caller tear the daemon down — TrayHost itself
   * only owns window/tray visibility, not process lifecycle.
   */
  onQuit?: () => void;
}

export class TrayHost {
  private visibility: Visibility = "hidden";
  /**
   * "Keep open" pin — when true the window ignores blur auto-hide. The window
   * is ALWAYS kept on top regardless of this flag (keepOnTop is permanent); the
   * pin only decides whether a blur may request page-owned auto-close.
   */
  private pinned = false;
  /**
   * True while the daemon has authorized a WebUI exit animation. The actual
   * opacity timeline and countdown are page projections; this flag is the
   * platform intent that lets the page start or abort that timeline.
   */
  private exitRequested = false;
  /** Last known native focus state. Needed when canAutoClose changes while blurred. */
  private focused = false;
  private unsubs: Array<() => void> = [];

  constructor(
    private store: DaemonStore,
    private tray: OpentrayTray | null,
    private window: OpentrayWindow | null,
    private opts: TrayHostOptions = {},
  ) {
    this.visibility = opts.initialVisible ? "shown" : "hidden";
    this.focused = opts.initialVisible ?? false;
    // Seed the pin from persisted preferences (Chapter 6.4) and subscribe so
    // any later preference change (e.g. from the SettingsDialog) re-evaluates
    // auto-close. The window was created with this same value at mount time, so
    // no setStyle is needed. Preferences is the single source of truth for the
    // keep-open pin — there is no separate `setPin` verb.
    this.pinned = store.getPreferences().keepOnTop;
    const onPreferences = (p: { keepOnTop: boolean }) => this.onPreferences(p);
    this.store.on("preferences", onPreferences);
    this.unsubs.push(() => this.store.off("preferences", onPreferences));
    this.wireUp();
    // Sync the native menu to the initial visibility (createTray ships a static
    // menu; this relabels the primary item to match the real state).
    this.pushMenu();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
  }

  private get hasActiveEvents(): boolean {
    return this.store.getEvents().length > 0;
  }

  private get canAutoClose(): boolean {
    return !this.pinned && !this.hasActiveEvents;
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

  /** Push the current tray/window frame to the WebUI (best-effort). */
  private emitPinFrame(): void {
    try {
      this.opts.onPinFrame?.({
        exitRequested: this.exitRequested,
        visibility: this.visibility,
        hasActiveEvents: this.hasActiveEvents,
      });
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
    // A new event arrival is the ONE orthogonal source allowed to resurrect a
    // hidden window: it is the "open-on-new-event" rule, which must NOT live in
    // reevaluateAutoClose() — that method also runs on blur (an unavoidable
    // side effect of hide()), where this rule would immediately undo a user's
    // "Hide window" click. Scoped here so only genuinely new events re-show.
    const onStoreEvent = () => {
      if (this.hasActiveEvents && this.visibility === "hidden") {
        this.show();
        return;
      }
      this.reevaluateAutoClose();
    };
    this.store.on("event", onStoreEvent);
    this.unsubs.push(() => {
      this.store.off("event", onStoreEvent);
    });

    // Blur/focus only changes eligibility. The WebUI owns the animation clock.
    if (this.window) {
      const offBlur = this.window.listen("blur", () => {
        this.log("window blur");
        this.focused = false;
        this.reevaluateAutoClose();
      });
      this.unsubs.push(offBlur);
      const offFocus = this.window.listen("focus", () => {
        this.log("window focus");
        this.focused = true;
        this.cancelAutoClose();
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
   * Re-check whether the current native/window state should run auto-close.
   * This is called from every orthogonal source that can change the answer:
   * focus, pin preference, and pending-event presence. It deliberately does
   * NOT re-show a hidden window on active events — that rule belongs only to
   * the store "event" subscriber (a new event arrival), since this method also
   * runs on blur, which is an unavoidable side effect of hide().
   */
  private reevaluateAutoClose(): void {
    if (this.visibility !== "shown" || this.focused) {
      this.cancelAutoClose();
      return;
    }
    if (this.canAutoClose) this.requestAutoClose();
    else this.cancelAutoClose();
  }

  private requestAutoClose(): void {
    if (!this.canAutoClose) {
      this.cancelAutoClose();
      return;
    }
    if (this.exitRequested) {
      this.emitPinFrame();
      return;
    }
    this.exitRequested = true;
    this.emitPinFrame();
  }

  private cancelAutoClose(): void {
    if (!this.exitRequested) {
      this.emitPinFrame();
      return;
    }
    this.exitRequested = false;
    this.emitPinFrame();
  }

  /** Restore window visibility (skill: show() restores, never re-bootstraps). */
  show(): void {
    this.exitRequested = false;
    this.focused = true;
    // Non-animated seed only: WebUI owns the enter animation clock, but the host
    // sets opacity before show() so native restore never flashes at 1.
    this.safeCall(
      "setStyle(opacity)",
      this.window?.setStyle({ opacity: WINDOW_ENTER_SEED_OPACITY }),
    );
    const showP = this.window?.show();
    this.safeCall("show", showP);
    // keepOnTop is PERMANENT (the window always stays above others). Re-apply
    // on show so a freshly-resurrected window is still on top.
    this.applyKeepOnTop(showP);
    this.visibility = "shown";
    this.pushMenu();
    this.emitPinFrame();
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
    this.exitRequested = false;
    this.focused = false;
    this.safeCall("hide", this.window?.hide());
    this.visibility = "hidden";
    this.pushMenu();
    this.emitPinFrame();
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
    this.exitRequested = false;
    this.focused = false;
    this.visibility = "hidden";
    this.pushMenu();
    this.emitPinFrame();
  }

  /**
   * Called by the WebUI when its WAAPI exit animation reaches completion. The
   * daemon validates that auto-close is still authorized before hiding; stale
   * completions after focus, pin, or active-event changes are ignored.
   */
  completeAutoClose(): void {
    if (!this.exitRequested || !this.canAutoClose) {
      this.cancelAutoClose();
      return;
    }
    this.hide();
  }

  /**
   * React to a persisted-preferences change (the keep-open pin and any future
   * field). The pin is the only preference TrayHost consumes today: it gates
   * blur auto-hide. The window's keepOnTop style is permanent and NOT affected
   * by the pin. Re-evaluates auto-close so a freshly-pinned window cancels any
   * in-flight exit, and a freshly-unpinned one becomes eligible.
   */
  private onPreferences(p: { keepOnTop: boolean }): void {
    if (this.pinned === p.keepOnTop) return;
    this.pinned = p.keepOnTop;
    this.log(`keep-open pin set to ${p.keepOnTop}`);
    this.reevaluateAutoClose();
  }

  /** Current tray/window frame (for the WebUI initial snapshot). */
  getPinState(): TrayPinFrame {
    return {
      exitRequested: this.exitRequested,
      visibility: this.visibility,
      hasActiveEvents: this.hasActiveEvents,
    };
  }

  async destroy(): Promise<void> {
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
