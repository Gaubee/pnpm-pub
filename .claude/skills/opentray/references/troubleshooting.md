# Troubleshooting

Use this reference when OpenTray installs successfully but native behavior is missing, stale, or platform-specific.

## WebView Window Does Not Appear

- Install both `opentray` and `@opentray/ext-webview` on macOS or Windows.
- Call `show()` once before registering window listeners or using retained-session verbs.
- Treat unsupported capability failures as real failures; do not accept an invisible window as success.

## Show/Hide Menu Is Wrong After Minimize

Requires OpenTray `0.14.3` or newer.

```text
first show -> listen(visibleChange)
tray click -> await isVisible() -> close() or toVisible()
```

Do not maintain a page-owned visibility boolean and do not infer native state from `document.visibilityState`. `visibleChange(false)` includes minimize, hidden/closed state, and native auto-hide.

## Window Appears In Taskbar Or App Switcher

Tray utility windows should use `style.platform.windows.showInSwitchers: false` (the OpenTray utility-window default). Use `true` only when the surface should behave like a normal application window. On Windows comparator topology, use `0.14.3` or newer so utility projection is not bypassed.

## Blur Does Not Hide The Window

Native state machine:

```text
autoHide: false -> remain visible
keepOnTop: true -> remain visible
otherwise       -> native retained hide
```

If the app owns a page exit animation, `autoHide: false` is intentional; the page signals completion and the host calls `close()`. If neither condition applies, inspect the actual style returned by `setStyle`/`stylechange`.

## Broker Connection Closed Repeats

Window event polling must not outlive the retained session/runtime. Install listeners after first `show()`, invoke every unlisten callback during shutdown, then destroy the WebView and tray/runtime in that order. Repeated polling errors usually mean listener teardown was skipped or the runtime closed before subscribers stopped.

## Windows Frameless Differs From webview-control

Read `windows-frameless.md`. OpenTray `0.14.3` source `webview-control` can select an internal comparator topology with native left/right/bottom resize insets and a visible-border-only top edge; ordinary consumers do not inherit that topology from `frameless` alone.

For pnpm-pub, the compatibility bridge selects comparator topology before broker creation. Set `PNPM_PUB_OPENTRAY_WINDOWS_HOST_TOPOLOGY=production` only for rollback/A-B diagnosis.

## Icon Looks Missing

Current native icon materialization supports RGBA-backed shapes. URL/SVG shapes can remain logical icon state when the platform cannot decode them into a native image.

## Extension Loader Debugging

`OPENTRAY_EXT_PATH` may point at an explicit extension directory for custom-runtime debugging. Published consumers should rely on package-adjacent resolution.
