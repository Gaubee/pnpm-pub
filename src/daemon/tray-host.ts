/**
 * Orthogonal intentions (2026-07-17):
 * 1. Original request: minimized/native-hidden windows must immediately project "Show window".
 * 2. Keep one retained WebView session: bootstrap with show(), reveal with toVisible(), hide with close().
 * 3. Treat OpenTray isVisible()/visibleChange as native visibility truth, including minimize.
 * 4. Preserve pnpm-pub's page-owned blur exit animation and persisted keep-open guard.
 * 5. Keep tray operations best-effort so native failures never terminate the daemon.
 */
import type { WebviewTrayCapability, WebviewWindowHandle } from "@opentray/ext-webview";
import type { EventfulTrayHandle, Menu, TrayIcon as OpentrayTrayIcon } from "opentray";
import { WINDOW_ENTER_SEED_OPACITY } from "../shared/window-opacity.js";
import type { DaemonStore } from "./store.js";

export type OpentrayTray = EventfulTrayHandle & WebviewTrayCapability;
export type OpentrayWindow = WebviewWindowHandle;
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
  /** Tray menu label for the show action (window currently hidden/minimized). */
  showLabel?: string;
  /** Tray menu label for the hide action (window currently visible). */
  hideLabel?: string;
  /** Tray menu label for the Quit action. */
  quitLabel?: string;
  /** Initial native visibility after the one-time WebView bootstrap show(). */
  initialVisible?: boolean;
  /** Projects daemon-owned tray/window state to connected WebUI clients. */
  onPinFrame?: (frame: TrayPinFrame) => void;
  /** Delegates graceful process shutdown to the daemon owner. */
  onQuit?: () => void;
}

export class TrayHost {
  /** Cached projection of native operational visibility, never an independent guess. */
  private visibility: Visibility = "hidden";
  /** Persisted keep-open guard; native keepOnTop remains a separate window style. */
  private pinned = false;
  private routePathname = "/";
  private exitRequested = false;
  private focused = false;
  private unsubs: Array<() => void> = [];
  /** Serializes query + transition pairs so rapid tray clicks cannot invert stale state. */
  private windowOperation: Promise<void> = Promise.resolve();

  constructor(
    private store: DaemonStore,
    private tray: OpentrayTray | null,
    private window: OpentrayWindow | null,
    private opts: TrayHostOptions = {},
  ) {
    this.visibility = opts.initialVisible ? "shown" : "hidden";
    this.focused = opts.initialVisible ?? false;
    this.pinned = store.getPreferences().keepOnTop;

    const onPreferences = (preferences: { keepOnTop: boolean }) => this.onPreferences(preferences);
    this.store.on("preferences", onPreferences);
    this.unsubs.push(() => this.store.off("preferences", onPreferences));

    this.wireUp();
    this.pushMenu();
  }

  private log(line: string): void {
    this.opts.log?.(`[tray] ${line}`);
  }

  private get hasActiveEvents(): boolean {
    return this.store.getEvents().length > 0;
  }

  private get canAutoClose(): boolean {
    return !this.pinned && !this.hasActiveEvents && !this.isRouteVisibilityProtected;
  }

  private get isRouteVisibilityProtected(): boolean {
    return this.routePathname === "/add-profile";
  }

  /** Keep native command failures observable without leaking rejected promises. */
  private safeCall(label: string, operation: Promise<unknown> | undefined): void {
    if (!operation) return;
    operation.catch((error: unknown) => this.log(`${label} failed: ${errorToLogMessage(error)}`));
  }

  /** Queue a compound visibility operation and contain all native failures. */
  private enqueueWindowOperation(label: string, operation: () => Promise<void>): Promise<void> {
    const run = async () => {
      try {
        await operation();
      } catch (error) {
        this.log(`${label} failed: ${errorToLogMessage(error)}`);
      }
    };
    this.windowOperation = this.windowOperation.then(run, run);
    return this.windowOperation;
  }

  private emitPinFrame(): void {
    try {
      this.opts.onPinFrame?.({
        exitRequested: this.exitRequested,
        visibility: this.visibility,
        hasActiveEvents: this.hasActiveEvents,
      });
    } catch {
      /* Projection failures must not affect native lifecycle. */
    }
  }

  private wireUp(): void {
    const openId = this.opts.openItemId ?? 1;
    const quitId = this.opts.quitItemId;

    if (this.tray) {
      const offMenu = this.tray.onMenuClick(({ itemId }) => {
        this.log(`menu click received: itemId=${itemId}`);
        if (itemId === openId) {
          return this.toggle();
        }
        if (quitId === undefined || itemId !== quitId) return;
        this.log("quit requested");
        try {
          this.opts.onQuit?.();
        } catch (error) {
          this.log(`onQuit failed: ${errorToLogMessage(error)}`);
        }
      });
      this.unsubs.push(offMenu);
    }

    const onStoreEvent = () => {
      if (this.hasActiveEvents && this.visibility === "hidden") {
        void this.show();
        return;
      }
      this.reevaluateAutoClose();
    };
    this.store.on("event", onStoreEvent);
    this.unsubs.push(() => this.store.off("event", onStoreEvent));

    if (!this.window) return;
    this.unsubs.push(
      this.window.listen("visibleChange", ({ payload }) => {
        this.applyNativeVisibility(payload.visible, "visibleChange");
      }),
      this.window.listen("blur", () => {
        this.log("window blur");
        this.focused = false;
        this.reevaluateAutoClose();
      }),
      this.window.listen("focus", () => {
        this.log("window focus");
        this.focused = true;
        this.cancelAutoClose();
      }),
    );
  }

  /** Swap the native tray icon projection. */
  setIcon(icon: TrayIcon | undefined): void {
    if (!icon) return;
    this.safeCall("setIcon", this.tray?.setIcon(icon));
  }

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
    if (!this.exitRequested) this.exitRequested = true;
    this.emitPinFrame();
  }

  private cancelAutoClose(): void {
    if (this.exitRequested) this.exitRequested = false;
    this.emitPinFrame();
  }

  /** Read native operational visibility; cached state is only a failure fallback. */
  private async queryNativeVisibility(fallback: boolean): Promise<boolean> {
    if (!this.window) return fallback;
    try {
      return await this.window.isVisible();
    } catch (error) {
      this.log(`isVisible failed: ${errorToLogMessage(error)}`);
      return fallback;
    }
  }

  /** Apply one native visibility fact to menu state and WebUI projection. */
  private applyNativeVisibility(visible: boolean, source: string): void {
    const next: Visibility = visible ? "shown" : "hidden";
    const changed = this.visibility !== next;
    this.visibility = next;
    if (!visible) {
      this.exitRequested = false;
      this.focused = false;
    }
    if (changed) {
      this.pushMenu();
      this.log(`${source}: ${next}`);
    }
    this.emitPinFrame();
  }

  /** Reveal or restore the retained session after its one-time bootstrap show(). */
  private async revealRetainedWindow(): Promise<void> {
    this.exitRequested = false;
    this.focused = true;
    if (!this.window) {
      this.applyNativeVisibility(true, "headless reveal");
      return;
    }

    try {
      await this.window.setStyle({ opacity: WINDOW_ENTER_SEED_OPACITY });
    } catch (error) {
      this.log(`setStyle(opacity) failed: ${errorToLogMessage(error)}`);
    }
    await this.window.toVisible();
    try {
      await this.window.setStyle({ keepOnTop: true });
    } catch (error) {
      this.log(`setStyle(keepOnTop) failed: ${errorToLogMessage(error)}`);
    }
    this.applyNativeVisibility(await this.queryNativeVisibility(true), "toVisible");
  }

  /** Hide the retained session without destroying its page runtime. */
  private async closeRetainedWindow(): Promise<void> {
    this.exitRequested = false;
    this.focused = false;
    if (!this.window) {
      this.applyNativeVisibility(false, "headless close");
      return;
    }

    await this.window.close();
    this.applyNativeVisibility(await this.queryNativeVisibility(false), "close");
  }

  /** Restore a hidden or minimized retained window. */
  show(): Promise<void> {
    return this.enqueueWindowOperation("toVisible", () => this.revealRetainedWindow());
  }

  /** Hide the retained window while preserving its WebView session. */
  hide(): Promise<void> {
    return this.enqueueWindowOperation("close", () => this.closeRetainedWindow());
  }

  /** Primary tray action: query native truth immediately before choosing the transition. */
  toggle(): Promise<void> {
    return this.enqueueWindowOperation("toggle visibility", async () => {
      const visible = await this.queryNativeVisibility(this.visibility === "shown");
      this.applyNativeVisibility(visible, "isVisible");
      if (visible) await this.closeRetainedWindow();
      else await this.revealRetainedWindow();
    });
  }

  /** Complete a WebUI-owned exit animation only while auto-close is still authorized. */
  async completeAutoClose(): Promise<void> {
    if (!this.exitRequested || !this.canAutoClose) {
      this.cancelAutoClose();
      return;
    }
    await this.hide();
  }

  /** Update the route-owned visibility guard. */
  setRoute(pathname: string): void {
    if (this.routePathname === pathname) return;
    this.routePathname = pathname;
    this.log(`route changed: ${pathname}`);
    this.reevaluateAutoClose();
  }

  private onPreferences(preferences: { keepOnTop: boolean }): void {
    if (this.pinned === preferences.keepOnTop) return;
    this.pinned = preferences.keepOnTop;
    this.log(`keep-open pin set to ${preferences.keepOnTop}`);
    this.reevaluateAutoClose();
  }

  /** Current native-window projection for initial WebUI state. */
  getPinState(): TrayPinFrame {
    return {
      exitRequested: this.exitRequested,
      visibility: this.visibility,
      hasActiveEvents: this.hasActiveEvents,
    };
  }

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

  private pushMenu(): void {
    if (!this.tray) return;
    this.safeCall("setMenu", this.tray.setMenu(this.buildMenu()));
  }

  async destroy(): Promise<void> {
    for (const off of this.unsubs) {
      try {
        off();
      } catch {
        /* Ignore listener teardown gaps. */
      }
    }
    this.unsubs = [];
    await this.windowOperation;
    try {
      await this.window?.destroy();
    } catch {
      /* Ignore native teardown gaps. */
    }
    try {
      await this.tray?.destroy();
    } catch {
      /* Ignore native teardown gaps. */
    }
  }

  /** Exposed for diagnostics and focused unit coverage. */
  getVisibility(): Visibility {
    return this.visibility;
  }
}

function errorToLogMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
