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
  setIcon?(icon: { type: 'file'; path: string }): Promise<void>;
  setTooltip?(tooltip: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface OpentrayWindow {
  show(): Promise<unknown>;
  hide(): Promise<unknown>;
  /** Restore visibility without replaying startup options (skill rule). */
  show(command?: unknown): Promise<unknown>;
  setStyle(style: { keepOnTop?: boolean; background?: unknown }): Promise<unknown>;
  /** Listen for a window lifecycle event; returns an unsubscribe. */
  listen(event: string, handler: () => void): () => void;
  destroy(): Promise<void>;
}

export interface TrayHostOptions {
  /** Tray title (kept static; pending is NOT signaled via the title). */
  title?: string;
  /** Log sink for dev/test observability. */
  log?: (line: string) => void;
  /** Fired when the window hides while pending events remain (Chapter 6.2.2). */
  onWindowHidden?: () => void;
  /** Menu item id that opens the window (primaryEvent). */
  openItemId?: number;
  /** Base tray icon path (idle state). */
  baseIcon?: string;
  /** Tray icon path with a pending badge (corner dot). */
  pendingIcon?: string;
  /** Swaps the tray icon. Used to apply/clear the pending badge. */
  setIcon?: (path: string) => void | Promise<void>;
}

type Visibility = 'hidden' | 'shown' | 'pinned';

export class TrayHost {
  private visibility: Visibility = 'hidden';
  private unsubs: Array<() => void> = [];
  private badgeApplied = false;

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
      p.catch((error: unknown) => this.log(`${label} failed: ${errorToLogMessage(error)}`));
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
        (error: unknown) => this.log(`show failed during pin: ${errorToLogMessage(error)}`),
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
   * Signal "pending" by swapping to the badged tray icon (NOT by mutating the
   * title). opentray exposes no native badge API, so we keep two icon files and
   * setIcon() between them. KeepOnTop + the badged icon read as
   * "awaiting confirmation" without any title flicker.
   */
  private startFlash(): void {
    if (this.badgeApplied) return;
    this.badgeApplied = true;
    if (this.opts.pendingIcon && this.opts.setIcon) {
      this.safeCall('setIcon(pending)', Promise.resolve(this.opts.setIcon(this.opts.pendingIcon)));
    }
  }

  private stopFlash(): void {
    this.badgeApplied = false;
    if (this.opts.baseIcon && this.opts.setIcon) {
      this.safeCall('setIcon(idle)', Promise.resolve(this.opts.setIcon(this.opts.baseIcon)));
    }
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

function errorToLogMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
