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

/**
 * The page-facing native window bridge. `startAppRegionDrag()` hands a
 * pointerdown to the native window manager (overlay chrome drag); `overlay`
 * exposes titlebar geometry so the page can reserve space for OS controls;
 * `resizeTo()` lets the page set the OS window size at runtime (used to give
 * each route its preferred default geometry).
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
