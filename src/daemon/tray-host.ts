/**
 * Tray host behaviors (Chapter 6.4) — built directly on the opentray public API
 * per the skill's "Tray-Launched WebView Surface" scenario card.
 *
 *   const tray = (await createTray({ menu, primaryEvent })).extend(WebviewExt);
 *   const panel = tray.createWebviewWindow({ url, ... });
 *   tray.onMenuClick(({ itemId }) => { if (itemId === OPEN_ID) panel.show(); });
 *
 * We keep the real typed handles (TrayHandle & WebviewTrayCapability +
 * WebviewWindowHandle) instead of inventing a parallel abstraction. The host
 * layering on top is purely the product behavior the skill leaves to the app:
 *   - blur auto-hide (reversible dismissal, NOT destroy)
 *   - pending-event KeepOnTop override + tray-title flash
 *   - reject pending publishes when the window is hidden with events outstanding
 *
 * opentray lifecycle rule (skill ext-webview.md): createWebviewWindow bootstraps
 * ONCE per session; repeated tray activations restore via show()/hide() and must
 * NOT replay startup width/height/style. So this host never re-creates the
 * panel — it toggles visibility and mutates style only when KeepOnTop changes.
 */
import type { DaemonStore } from './store.js';

/**
 * The opentray surfaces this host drives. Typed loosely enough to compile
 * without a hard type-only dep on the SDK internals, but mirrors
 * `TrayHandle & WebviewTrayCapability` + `WebviewWindowHandle`.
 */
export interface OpentrayTray {
  onMenuClick(handler: (e: { itemId?: number }) => void): () => void;
  setTitle(title: string): Promise<void>;
  setTooltip?(tooltip: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface OpentrayWindow {
  show(): Promise<unknown>;
  hide(): Promise<unknown>;
  /** Restore visibility without replaying startup options (skill rule). */
  show(command?: unknown): Promise<unknown>;
  setStyle(style: { frameless?: boolean; keepOnTop?: boolean; background?: unknown }): Promise<unknown>;
  /** Listen for a window lifecycle event; returns an unsubscribe. */
  listen(event: string, handler: () => void): () => void;
  destroy(): Promise<void>;
}

export interface TrayHostOptions {
  /** Initial tray title (restored when flash stops). */
  title?: string;
  /** Log sink for dev/test observability. */
  log?: (line: string) => void;
  /** Fired when the window hides while pending events remain (Chapter 6.2.2). */
  onWindowHidden?: () => void;
  /** Menu item id that opens the window (primaryEvent). */
  openItemId?: number;
}

type Visibility = 'hidden' | 'shown' | 'pinned';

export class TrayHost {
  private visibility: Visibility = 'hidden';
  private unsubs: Array<() => void> = [];
  private flashTimer: ReturnType<typeof setInterval> | null = null;
  private flashOn = false;

  constructor(
    private store: DaemonStore,
    private tray: OpentrayTray | null,
    private window: OpentrayWindow | null,
    private opts: TrayHostOptions = {},
  ) {
    this.wireUp();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
  }

  /**
   * Run an opentray op, swallowing + logging any rejection. opentray commands
   * route through the broker and can reject asynchronously (e.g. a stale
   * SINGLE_SESSION, a capability gap); a window op failure must NEVER crash the
   * daemon or propagate as an unhandled rejection — the IPC/HTTP/WS surfaces
   * stay up and the WebUI remains reachable in a browser.
   */
  private safeCall(label: string, p: Promise<unknown> | undefined): void {
    if (!p) return;
    if (typeof p.catch === 'function') {
      p.catch((err) => this.log(`${label} failed: ${(err as Error)?.message ?? err}`));
    }
  }

  private wireUp(): void {
    const openId = this.opts.openItemId ?? 1;
    // Skill scenario: tray click → show() on the SAME panel handle.
    if (this.tray) {
      const off = this.tray.onMenuClick(({ itemId }) => {
        if (itemId === openId) void this.show();
      });
      this.unsubs.push(off);
    }
    // Skill rule: hide() is reversible dismissal. We auto-hide on blur unless a
    // pending event forces KeepOnTop (pin()).
    if (this.window) {
      const off = this.window.listen('blur', () => {
        if (!this.hasPending()) this.hide();
      });
      this.unsubs.push(off);
    }
    // Pending events drive the pin/release state machine.
    const onEvent = (): void => this.syncFromPending();
    this.store.on('event', onEvent);
    this.unsubs.push(() => this.store.removeListener('event', onEvent));
    this.syncFromPending();
  }

  private hasPending(): boolean {
    return this.store.getEvents().some((e) => e.status === 'pending');
  }

  /** Restore window visibility (skill: show() restores, never re-bootstraps). */
  show(): void {
    if (this.visibility === 'pinned') return; // already forced visible
    this.safeCall('show', this.window?.show());
    this.visibility = 'shown';
    this.log('show');
  }

  /** Reversible dismissal (skill: hide(), NOT destroy()). */
  hide(): void {
    // Chapter 6.2.2: hiding while pending events remain rejects them so a
    // suspended CLI exits instead of hanging.
    if (this.hasPending()) {
      this.log('window hidden with pending events — rejecting them');
      this.opts.onWindowHidden?.();
    }
    if (this.visibility === 'pinned') return; // KeepOnTop overrides blur-hide
    this.safeCall('hide', this.window?.hide());
    this.visibility = 'hidden';
    this.log('hide');
  }

  /**
   * Pending-event override (Chapter 6.4 强制唤起): pin the window on top and
   * flash the tray title until the event resolves. Uses setStyle({keepOnTop})
   * on the real handle — a real style mutation, per the skill.
   *
   * Operations are sequenced (show THEN setStyle) because the webview extension
   * rejects setStyle if the window isn't fully shown yet; calling them in
   * parallel races the broker.
   */
  private pin(): void {
    if (this.visibility === 'pinned') return;
    this.visibility = 'pinned';
    this.startFlash();
    this.log('pin (keepOnTop + flash)');
    // Sequence: show() must settle before setStyle({keepOnTop}).
    const showP = this.window?.show();
    if (showP && typeof showP.then === 'function') {
      showP.then(
        () => this.safeCall('setStyle(keepOnTop)', this.window?.setStyle({ keepOnTop: true })),
        (err) => this.log(`show failed during pin: ${(err as Error)?.message ?? err}`),
      );
    } else {
      this.safeCall('setStyle(keepOnTop)', this.window?.setStyle({ keepOnTop: true }));
    }
  }

  private release(): void {
    if (this.visibility !== 'pinned') return;
    this.safeCall('setStyle(keepOnTop=false)', this.window?.setStyle({ keepOnTop: false }));
    this.stopFlash();
    // Resume the ghost idle state.
    this.safeCall('hide', this.window?.hide());
    this.visibility = 'hidden';
    this.log('release');
  }

  /**
   * Apply a stable "pending" badge to the tray title (a single dot prefix) and
   * let KeepOnTop + the icon signal urgency. We deliberately do NOT toggle the
   * title on a timer — rapid title flicker is jarring and not idiomatic for a
   * tray; a steady badge plus a pinned window reads as "awaiting confirmation".
   */
  private startFlash(): void {
    if (this.flashTimer || !this.tray) return;
    this.flashTimer = 1 as unknown as ReturnType<typeof setInterval>; // mark "badge applied"
    this.safeCall('setTitle(pending)', this.tray.setTitle(`● ${this.opts.title ?? 'pnpm-pub'}`));
  }

  private stopFlash(): void {
    if (this.flashTimer) this.flashTimer = null;
    this.flashOn = false;
    this.safeCall('setTitle(idle)', this.tray?.setTitle(this.opts.title ?? 'pnpm-pub'));
  }

  /** Recompute pin/release from the current pending-event set. */
  syncFromPending(): void {
    if (this.hasPending()) this.pin();
    else this.release();
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
    this.stopFlash();
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
