# ext-webview

Use this reference for the official OpenTray WebView extension. The retained-window lifecycle below requires OpenTray `0.14.3` or newer.

## Install

```bash
pnpm add opentray @opentray/ext-webview
```

The facade is platform-neutral. Native WebView packages are published for macOS and Windows; Linux has no official `@opentray/ext-webview` runtime package.

## Retained Window Contract

Create one tray, extend it once, create one window handle, and bootstrap it once:

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const openId = 1;
const menu = (visible: boolean) => ({
  items: [
    {
      type: "item" as const,
      id: openId,
      title: visible ? "Hide window" : "Show window",
      primaryEvent: true,
    },
  ],
});

const tray = (
  await createTray({ id: "panel", menu: menu(false) }, { appId: "panel", appName: "Panel" })
).extend(WebviewExt);
const panel = tray.createWebviewWindow({
  html: "<main>Hello</main>",
  width: 360,
  height: 220,
  style: { platform: { windows: { showInSwitchers: false } } },
});

await panel.show();
const stopVisibleChange = panel.listen("visibleChange", ({ payload }) => {
  void tray.setMenu(menu(payload.visible));
});
await tray.setMenu(menu(true));

tray.onMenuClick(({ itemId }) => {
  if (itemId !== openId) return;
  void (async () => {
    if (await panel.isVisible()) await panel.close();
    else await panel.toVisible();
  })();
});
```

```text
createWebviewWindow(options)
  -> show() once: load native extension + create page runtime
  -> listen(visibleChange)
  -> isVisible() before each tray toggle
       +-- true  -> close(): hide retained session
       `-- false -> toVisible(): reveal hidden or minimized session
```

Rules:

- `visibleChange(false)` covers hidden/closed, minimized, and native auto-hide states.
- Do not infer native visibility from `document.visibilityState`, page blur, or a private boolean.
- Do not call `show(options)` again to restore a retained session; startup size, style, content, and native API flags are bootstrap declarations.
- Use `destroy()` only when page state should be discarded.
- Install native listeners only after the first successful `show()`, and unsubscribe before final destroy.

## Blur Ownership

Native tray windows default to:

```text
native blur
  +-- autoHide: false -> remain visible
  +-- keepOnTop: true -> remain visible
  `-- otherwise      -> hide retained session -> visibleChange(false)
```

Use native `autoHide` for ordinary tray panels. Set `autoHide: false` when the page owns an exit animation, protected form, or diagnostic flow; after the page completes, the host calls `close()`.

`style.platform.windows.showInSwitchers` is independent. Windows tray utility windows default to `false`, excluding them from the taskbar and Alt+Tab. Set it to `true` only for a normal app-window role.

## Host Operations

`WebviewWindowHandle` provides:

- lifecycle: `show`, `close`, `destroy`, `isClosed`, `isVisible`, `toVisible`
- geometry: `moveTo`, `resizeTo`, `getBounds`, size constraints
- appearance: `setStyle`, `setBackground`
- content: `setContent`, `navigate`, `evaluate`, `postMessage`
- integration: `drainIpcMessages`, permission messages, DevTools

Page-side `navigator.opentrayWindow` exposes standard window commands. Host code should still own tray lifecycle and menu synchronization.

## Placement Kit

`WebviewPlacementKit` composes tray/screen geometry with an existing WebView handle:

```ts
const watch = await new WebviewPlacementKit({ tray, screen: webviewTray }).watch(panel, {
  placement: "tray",
  placementMargin: 8,
});
```

`watch()` follows position and yields to live drag/resize until bounds settle. It must not continuously restore a stale size. Use `applyOnce()` when one-shot placement and size application are intentional. Stop watches before final destroy; pause or stop them when hidden if their polling would fight lifecycle.

All public placement rectangles use logical desktop pixels. Physical pixels belong only inside native Win32/AppKit/WebView substrate code.

## Frameless And Overlay

- `frameless` removes native titlebar/chrome; the page owns controls, accessibility, and deliberate drag regions.
- `resizable` is an independent public setting.
- `windowControlsOverlay` retains native controls while page content enters titlebar space.
- Native semantic blur/material is a window background concern, not CSS `backdrop-filter`.
- Do not inject titlebars, drag strips, or CSS into consumer pages.

On Windows, read `windows-frameless.md` before comparing a package consumer with source `example:webview-control`; the source example may select an internal comparator topology.

## Visual Sources

Use source examples according to the question:

```bash
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
```

Final visual acceptance must run the actual consumer app. Verify taskbar/switcher participation, minimize -> `visibleChange(false)`, one-click restore, blur auto-hide ownership, retained page state, placement, and every resize edge.
