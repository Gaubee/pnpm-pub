/**
 * Tray host behaviors (Chapter 6.4).
 *
 * Wraps opentray's eventful tray handle and implements the three host rules:
 *   - On-demand show: tray click -> show the WebUI window.
 *   - Blur auto-hide: window loses focus -> hide (saves taskbar space).
 *   - KeepOnTop override: a pending event forces the window to stay visible and
 *     on top, and flashes the tray icon until the event is resolved.
 *
 * The store's event stream drives KeepOnTop: when any event is `pending`, the
 * override is active. opentray is loaded lazily and only if present; in
 * dev/headless (no opentray build) the host records state transitions to the
 * daemon log so the behavior is observable and testable rather than a silent
 * no-op.
 */
import type { DaemonStore } from './store.js';

/** The subset of opentray we depend on (kept loose so the SDK can evolve). */
export interface TrayHandleLike {
  onTrayClick(handler: () => void): () => void;
  onTrayDoubleClick?(handler: () => void): () => void;
  setIcon(icon: { source: string }): Promise<void>;
  setTitle(title: string): Promise<void>;
  setTooltip?(tooltip: string): Promise<void>;
  destroy?(): Promise<void>;
}

export interface TraySurfaceLike {
  show(): Promise<void> | void;
  hide(): Promise<void> | void;
  setKeepOnTop?(on: boolean): Promise<void> | void;
  onFocusLoss?(handler: () => void): () => void;
  isVisible?(): Promise<boolean> | boolean;
}

export interface TrayHostOptions {
  /** The WebUI URL (with #token=...) for the window to load. */
  url: string;
  /** Initial tooltip/title. */
  title?: string;
  /** Path to the tray icon (NPM logo merged with avatar). */
  iconPath?: string;
  /** Hook for log lines so tests/dev can observe transitions. */
  log?: (line: string) => void;
  /**
   * Invoked when the window is hidden by the user (blur auto-hide / explicit
   * hide while NOT pinned by a pending event). The daemon uses this to reject
   * any still-pending publish events so a suspended CLI terminates gracefully
   * instead of hanging forever (Chapter 6.2.2 — "直接关闭了托盘窗口... 使终端
   * 优雅结束").
   */
  onWindowHidden?: () => void;
}

type State = 'hidden' | 'shown' | 'pinned';

export class TrayHost {
  private state: State = 'hidden';
  private unsubs: Array<() => void> = [];
  private flashTimer: ReturnType<typeof setInterval> | null = null;
  private flashOn = false;

  constructor(
    private store: DaemonStore,
    private handle: TrayHandleLike | null,
    private surface: TraySurfaceLike | null,
    private opts: TrayHostOptions,
  ) {
    this.wireUp();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
  }

  private wireUp(): void {
    if (this.handle) {
      const off = this.handle.onTrayClick(() => this.show());
      this.unsubs.push(off);
      this.handle.onTrayDoubleClick?.(() => this.show());
    }
    if (this.surface?.onFocusLoss) {
      const off = this.surface.onFocusLoss(() => {
        // Blur auto-hide — but only when no pending event forces KeepOnTop.
        if (!this.hasPending()) this.hide();
      });
      this.unsubs.push(off);
    }
    // React to event-status changes: pending => pin + flash; cleared => release.
    const handler = (): void => this.syncFromPending();
    this.store.on('event', handler);
    this.unsubs.push(() => this.store.removeListener('event', handler));
    this.syncFromPending();
  }

  private hasPending(): boolean {
    return this.store.getEvents().some((e) => e.status === 'pending');
  }

  /** Show the window (Chapter 6.4 — tray click). */
  show(): void {
    if (this.state === 'pinned') return; // already forced visible
    this.surface?.show();
    this.state = 'shown';
    this.log('show');
  }

  /** Hide the window (Chapter 6.4 — blur auto-hide). */
  hide(): void {
    // Chapter 6.2.2: if the user closes/hides the window while events are still
    // pending (only reachable via a force-close, since KeepOnTop pins the window
    // otherwise), reject them so suspended CLIs terminate gracefully.
    if (this.hasPending()) {
      this.log('window hidden with pending events — rejecting them');
      this.opts.onWindowHidden?.();
    }
    if (this.state === 'pinned') return; // KeepOnTop overrides blur
    this.surface?.hide();
    this.state = 'hidden';
    this.log('hide');
  }

  /**
   * Force the window on top and flash the tray while a pending event exists
   * (Chapter 6.4 — 强制唤起 KeepOnTop). Released automatically once the event
   * is resolved.
   */
  private pin(): void {
    if (this.state === 'pinned') return;
    this.state = 'pinned';
    this.surface?.setKeepOnTop?.(true);
    this.surface?.show();
    this.startFlash();
    this.log('pin (keepOnTop + flash)');
  }

  private release(): void {
    if (this.state !== 'pinned') return;
    this.surface?.setKeepOnTop?.(false);
    this.stopFlash();
    // After release, hide to resume the normal "ghost" idle state.
    this.surface?.hide();
    this.state = 'hidden';
    this.log('release');
  }

  private startFlash(): void {
    if (this.flashTimer || !this.handle) return;
    const handle = this.handle;
    this.flashTimer = setInterval(async () => {
      this.flashOn = !this.flashOn;
      try {
        await handle.setTitle(this.flashOn ? '● pending' : (this.opts.title ?? 'pnpm-pub'));
      } catch {
        /* ignore */
      }
    }, 600);
  }

  private stopFlash(): void {
    if (this.flashTimer) {
      clearInterval(this.flashTimer);
      this.flashTimer = null;
    }
    this.flashOn = false;
    this.handle?.setTitle(this.opts.title ?? 'pnpm-pub').catch(() => {});
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
    if (this.handle?.destroy) await this.handle.destroy();
  }

  /** Exposed for tests / observability. */
  getState(): State {
    return this.state;
  }
}
