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
 *   - tray primary click toggles show/hide
 *   - keepOnTop style applied on show when configured
 *
 * NOTE: an earlier version drove a pin/release state machine from pending
 * events (keepOnTop + window.hide() on resolve, auto-reject on hide, blur
 * auto-hide). That trapped the window and rejected events on focus loss, so it
 * has been removed. The tray now stays open until the user explicitly hides it;
 * pending events are surfaced only via the WebUI badge, never via window
 * lifecycle.
 *
 * opentray 0.8 removed its broker daemon concept: the tray lifetime is now owned
 * in-process by the caller (this daemon). createWebviewWindow bootstraps ONCE
 * per session; repeated tray activations restore via show()/hide() and must NOT
 * replay startup width/height/style. So this host never re-creates the panel —
 * it toggles visibility only.
 */
import type { EventfulTrayHandle } from 'opentray';
import type { WebviewTrayCapability, WebviewWindowHandle } from '@opentray/ext-webview';
import type { DaemonStore } from './store.js';

/**
 * The opentray surfaces this host drives, typed against the real SDK types.
 * `EventfulTrayHandle & WebviewTrayCapability` is what `tray.extend(WebviewExt)`
 * returns; `WebviewWindowHandle` is what `createWebviewWindow` returns.
 */
export type OpentrayTray = EventfulTrayHandle & WebviewTrayCapability;

export type OpentrayWindow = WebviewWindowHandle;

export interface TrayHostOptions {
  /** Tray title (kept static). */
  title?: string;
  /** Log sink for dev/test observability. */
  log?: (line: string) => void;
  /** Menu item id that opens the window (primaryEvent). */
  openItemId?: number;
  /** Whether show() applies a keepOnTop style (window stays above other apps). */
  keepOnTop?: boolean;
  /** Initial native window visibility when TrayHost takes ownership. */
  initialVisible?: boolean;
}

type Visibility = 'hidden' | 'shown';

export class TrayHost {
  private visibility: Visibility = 'hidden';
  private unsubs: Array<() => void> = [];

  constructor(
    private store: DaemonStore,
    private tray: OpentrayTray | null,
    private window: OpentrayWindow | null,
    private opts: TrayHostOptions = {},
  ) {
    this.visibility = opts.initialVisible ? 'shown' : 'hidden';
    this.wireUp();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
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
    if (typeof p.catch === 'function') {
      p.catch((error: unknown) => this.log(`${label} failed: ${errorToLogMessage(error)}`));
    }
  }

  private wireUp(): void {
    const openId = this.opts.openItemId ?? 1;
    // Skill scenario: tray click toggles the SAME panel handle.
    if (this.tray) {
      const off = this.tray.onMenuClick(({ itemId }) => {
        this.log(`menu click received: itemId=${itemId}`);
        if (itemId === openId) this.toggle();
      });
      this.unsubs.push(off);
    }
  }

  /** Restore window visibility (skill: show() restores, never re-bootstraps). */
  show(): void {
    const showP = this.window?.show();
    this.safeCall('show', showP);
    if (this.opts.keepOnTop) {
      if (showP && typeof showP.then === 'function') {
        showP.then(
          () => this.safeCall('setStyle(keepOnTop)', this.window?.setStyle({ keepOnTop: true })),
          () => {},
        );
      } else {
        this.safeCall('setStyle(keepOnTop)', this.window?.setStyle({ keepOnTop: true }));
      }
    }
    this.visibility = 'shown';
    this.log('show');
  }

  /** Primary tray click behavior for a tray-owned panel. */
  toggle(): void {
    if (this.visibility === 'hidden') this.show();
    else this.hide();
  }

  /** Reversible dismissal (skill: hide(), NOT destroy()). */
  hide(): void {
    this.safeCall('hide', this.window?.hide());
    this.visibility = 'hidden';
    this.log('hide');
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
