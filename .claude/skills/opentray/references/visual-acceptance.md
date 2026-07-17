# Visual Acceptance

Use this reference to prove a real native tray/window path. Protocol success is not visual acceptance.

## Side Effects

A smoke run can start or reuse the runtime, create visible tray/window UI, write versioned runtime state, and require explicit shutdown. Explain those effects before running it.

## Source Examples

```bash
pnpm --filter opentray example:webview-control -- --frameless --resizable --no-overlay
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
pnpm --filter opentray example:tray-panel
```

- `webview-control`: native lifecycle, controls, and comparator evidence.
- `placement`: tray/screen/edge placement and quiescent user movement.
- `mediaQuery`: responsive native style and size constraints.
- `tray-panel`: native auto-hide tray behavior.

Source examples do not prove an ordinary package consumer. Final acceptance must run the actual app with its published dependencies and creation options.

## Retained Lifecycle Checklist

Use OpenTray `0.14.3` or newer and verify in this order:

```text
first show
  -> taskbar/switcher role
  -> minimize
  -> visibleChange(false)
  -> tray label becomes Show
  -> one tray click calls toVisible()
  -> page state is retained
  -> tray hide calls close()
  -> one tray click restores again
```

Also verify:

- tray click queries `isVisible()` immediately before choosing close/reveal
- native close and native auto-hide produce `visibleChange(false)`
- no page `visibilityState` fallback is required
- listener cleanup occurs before runtime teardown

## Auto-Hide Ownership

Ordinary tray panel:

```text
autoHide: true + keepOnTop: false -> blur hides natively
```

Page-owned exit animation:

```text
autoHide: false -> blur requests page animation -> completion -> close()
```

Confirm a protected route, active operation, or keep-open pin cancels stale animation completion.

## Windows Utility Window

For a tray-only surface require:

- `style.platform.windows.showInSwitchers: false`
- no Windows taskbar button
- no stale Win7-like outer frame
- correct `Show window` label after minimize
- native resize on every enabled edge/corner
- no WebView-to-window top gap beyond the accepted 0-4 logical pixels

For pnpm-pub, compare default comparator topology with `PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY=production`; keep page, background, opacity, overlay, and geometry identical. OpenTray `0.14.3` is the minimum line for this lifecycle/taskbar acceptance.

## Geometry

Compare `await navigator.opentrayWindow.getBounds()` with `window.outerWidth/outerHeight`. Public values are logical desktop pixels. A screenshot alone cannot prove HWND client insets, taskbar projection, placement, or resize ownership.
