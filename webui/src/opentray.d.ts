/**
 * Ambient types for the OpenTray window bridge injected into the page when the
 * daemon hosts the WebUI inside a native opentray WebView window
 * (`nativeWindowApi: true` + `windowControlsOverlay: true`).
 *
 * The webui bundle does NOT import `@opentray/ext-webview` (it ships native
 * binaries and is backend-only), so this file is the page-side source of truth
 * for `navigator.opentrayWindow`. It mirrors the relevant subset of the
 * extension's `WebviewNavigatorWindow` / `WebviewWindowOverlay` shapes — only
 * the surface the drag strip + overlay geometry actually use. When the page
 * runs in a plain browser (no native host) these properties are simply absent.
 *
 * Keep this aligned with `@opentray/ext-webview`'s
 * `WebviewWindowOverlay` / `WebviewNavigatorWindow` (see ext-webview types).
 */

/** Logical CSS-pixel rectangle (matches @opentray/spec `Rect`). */
export interface OpentrayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Payload of the overlay `geometrychange` event (physical→CSS converted). */
export interface OpentrayOverlayGeometryChange {
  titlebarAreaRect: OpentrayRect;
}

/**
 * The OS window-control overlay. `getTitlebarAreaRect()` reports the titlebar
 * region the page may occupy; the OS min/max/close cluster sits outside it.
 */
export interface OpentrayWindowOverlay {
  readonly visible: boolean;
  getTitlebarAreaRect(): Promise<OpentrayRect>;
  /** Native event subscription; returns an async unsubscribe. */
  listen?(
    event: "geometrychange",
    handler: (event: OpentrayOverlayGeometryChange) => void,
  ): Promise<() => Promise<void>>;
  /** DOM-style fallback subscription. */
  addEventListener?(
    event: "geometrychange",
    handler: (event: OpentrayOverlayGeometryChange) => void,
  ): void;
  removeEventListener?(
    event: "geometrychange",
    handler: (event: OpentrayOverlayGeometryChange) => void,
  ): void;
}

/** Page-side native window style patch consumed by this WebUI. */
export interface OpentrayWindowStylePatch {
  /** Native window opacity, clamped by the host to the supported 0..1 range. */
  opacity?: number;
  /** Host-side permanent keep-on-top style; mirrored here for type parity. */
  keepOnTop?: boolean;
}

/**
 * Payload of the bridge `downloadcompleted` event. Emitted by the native host
 * after it finishes saving a page-triggered download to disk (the host owns
 * the `~/Downloads` write so it can sandbox the path). `filename` is the leaf
 * name actually written (may include a `(1)`/`(2)` suffix when the host had to
 * de-duplicate); `success` is false if the write failed. `id` echoes the
 * download-request id when the host tags one.
 */
export interface OpentrayDownloadCompletedEvent {
  event: "downloadcompleted";
  id?: number;
  payload: {
    filename: string;
    success: boolean;
    /** The blob URL the page handed the host (best-effort echo). */
    url?: string;
  };
}

/**
 * The page-facing native window bridge. `startAppRegionDrag()` hands a
 * pointerdown to the native window manager (overlay chrome drag); `overlay`
 * exposes titlebar geometry so the page can reserve space for OS controls;
 * `resizeTo()` lets the page set the OS window size at runtime (used to give
 * each route its preferred default geometry); `setStyle()` lets the WebUI map
 * its page-owned animation timeline onto native window style; the
 * `downloadcompleted` listener lets the page react to native downloads.
 */
export interface OpentrayWindowBridge {
  readonly overlay?: OpentrayWindowOverlay;
  startAppRegionDrag?(options?: {
    x?: number;
    y?: number;
    pointerId?: number;
  }): Promise<{ active: boolean }>;
  stopAppRegionDrag?(): Promise<{ active: boolean }>;
  /** Resize the OS window (logical CSS pixels). No-op when not in a host. */
  resizeTo?(width: number, height: number): Promise<{ width: number; height: number }>;
  /** Patch native window style. Used here only for opacity animation. */
  setStyle?(style: OpentrayWindowStylePatch): Promise<unknown>;
  /** Subscribe to a native window event (currently `downloadcompleted`). */
  addEventListener?(
    event: "downloadcompleted",
    handler: (e: OpentrayDownloadCompletedEvent) => void,
  ): void;
  removeEventListener?(
    event: "downloadcompleted",
    handler: (e: OpentrayDownloadCompletedEvent) => void,
  ): void;
}

declare global {
  interface Navigator {
    /** Present when the page runs inside an opentray native WebView host. */
    opentrayWindow?: OpentrayWindowBridge;
    /** Legacy/alt namespace some hosts expose; same bridge shape. */
    opentray?: {
      window?: OpentrayWindowBridge;
    };
  }
}
