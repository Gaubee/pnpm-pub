# Windows Frameless Host Topology

Use this reference when a Windows frameless consumer differs from source `example:webview-control`.

## Three Independent Facts

```text
chrome intent       -> frameless / overlay / native frame
resize topology     -> full-client soft resize OR native resize frame
utility lifecycle   -> showInSwitchers + autoHide + retained visibility
```

Never diagnose one dimension through another. A WebView control cannot create an outer HWND taskbar role or DWM frame by itself; those are host-window projections.

## Topology Model

```text
full-client borderless -> client fills HWND -> application soft resize
native resize frame     -> native L/R/B inset + visible top border -> DefWindowProc resize
```

`frameless` removes native titlebar/caption controls. `resizable` independently declares whether resize is allowed.

## OpenTray 0.14.3 Source Boundary

Source `example:webview-control` may set internal `OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR` before broker creation. The comparator preserves default left/right/bottom resize insets and replaces the top caption inset with `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`.

OpenTray `0.14.3` also preserves utility-window projection on this path:

```text
style.platform.windows.showInSwitchers: false -> WS_EX_TOOLWINDOW present
                       -> WS_EX_APPWINDOW absent
                       -> no taskbar entry
```

Therefore source-example screenshots are comparator evidence, not proof that an ordinary consumer receives the same HWND topology.

## pnpm-pub Compatibility Bridge

pnpm-pub selects the comparator before importing OpenTray or creating its broker:

```text
PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY unset
-> OPENTRAY_WINDOWS_NATIVE_MATERIAL_COMPARATOR=1
-> native resize-frame comparator
```

Rollback/A-B:

```powershell
$env:PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY = "production"
pnpm dev
```

The bridge belongs only in `src/daemon/opentray-windows-host.ts`. Do not spread the internal variable into WebUI, launchers, release scripts, or general consumer recipes.

## Retained Window Policy

pnpm-pub declares:

```text
keepOnTop: true
style.platform.windows.showInSwitchers: false
autoHide: false
```

`autoHide: false` is required because pnpm-pub owns a page exit animation. After animation completion, the host calls `close()`. Native minimize/close is observed through `visibleChange`; tray actions query `isVisible()` and choose `close()` or `toVisible()`.

Do not reintroduce page `document.visibilityState` reports. They confuse document unload with HWND visibility.

## Acceptance Matrix

| Dimension         | Comparator default                | Production rollback               |
| ----------------- | --------------------------------- | --------------------------------- |
| Client inset      | L/R/B native; top visible border  | full client                       |
| Resize owner      | Windows `DefWindowProc`           | OpenTray soft resize              |
| Switcher role     | utility, no taskbar               | utility, no taskbar               |
| Visibility source | `isVisible` + `visibleChange`     | `isVisible` + `visibleChange`     |
| Page lifetime     | retained across `close/toVisible` | retained across `close/toVisible` |

Verify geometry with `getBounds()` against `window.outerWidth/outerHeight`; accepted difference is 0-4 logical pixels. Then separately verify every resize edge, tray placement, minimize -> Show label, one-click restore, keep-on-top, and absence from the taskbar.

## Removal Gate

Delete the bridge and this special policy when a published OpenTray release provides the accepted native resize-frame topology through public `frameless: true, resizable: true` and pnpm-pub passes the same HWND, lifecycle, placement, taskbar, and visual acceptance without the internal variable.
