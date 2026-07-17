# OpenTray Scenario Cards

Use this reference when a user wants an app shape rather than a single API. Pick the closest card, explain the decision, then compose atoms. Do not silently mutate user HTML/CSS.

## Normal Tray Status

Use this when the product is a status contribution with a native tray menu.

Why: native menus are already accessible, platform-familiar, and cheap. Start here unless the user needs a rich custom surface.

```ts
const tray = await createTray({
  trayId: "status",
  title: "Status",
  icon: { type: "file", path: "./tray.png" },
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});
```

## Dynamic Tray State

Use this when app state changes after startup: timer phases, sync status, errors, or current task.

Why: tray state belongs to the tray atom. Do not rebuild the tray or send raw broker frames.

```ts
await tray.setTitle("Focus 18:42");
await tray.setTooltip({ title: "Pomodoro", description: "Focus session running" });
await tray.setMenu({ items: [{ type: "item", id: 1, title: "Pause", primaryEvent: true }] });
```

## Tray-Launched WebView Surface

Use this when a tray action opens one retained WebView session.

Why: operational visibility is a native fact. The menu queries `isVisible()` immediately before each action and follows `visibleChange` for minimize, close, and native auto-hide.

```ts
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
  await createTray({ id: "timer", menu: menu(false) }, { appId: "timer", appName: "Timer" })
).extend(WebviewExt);
const window = tray.createWebviewWindow({ html, width: 360, height: 240 });

await window.show();
window.listen("visibleChange", ({ payload }) => void tray.setMenu(menu(payload.visible)));
await tray.setMenu(menu(true));
tray.onMenuClick(({ itemId }) => {
  if (itemId !== openId) return;
  void (async () => {
    if (await window.isVisible()) await window.close();
    else await window.toVisible();
  })();
});
```

Keep the handle outside the click callback. `show()` is the one-time bootstrap; `toVisible()` reveals hidden/minimized state, `close()` hides without destroying page state, and `destroy()` ends the session.

## Tray-Anchored Lightweight Panel

Use this for custom menus, compact dashboards, and Pomodoro-style panels anchored to the tray.

Why: tray geometry is a tray-owned authority, while WebView owns the surface. The placement kit composes those atoms without creating a special panel API.

```ts
const webviewTray = tray.extend(WebviewExt);
const panel = webviewTray.createWebviewWindow({
  html,
  width: 328,
  height: 244,
  nativeWindowApi: true,
  style: { frameless: true, background: { kind: "semantic", token: "blur", state: "active" } },
});

await panel.show();
const placementWatch = await new WebviewPlacementKit({ tray, screen: webviewTray }).watch(panel, {
  placement: "tray",
  width: 328,
  height: 244,
  placementMargin: 8,
});
```

Design note: lightweight panels are closer to cards than documents. If the root document scrolls, consider a better window size or responsive card composition before accepting a browser-like page feel. Stop `placementWatch` when the panel is hidden, destroyed, or when another placement mode takes over.
When composing a real app, placement can coexist with host-side `setMinimumSize` / `setMaximumSize` and the backend `styleKit` / `mediaQueryKit` helpers, but debug them as separate atoms first. Use `example:placement` for tray/screen/edge placement and `example:mediaQuery` for responsive native-window style. Keep watches quiescent-aware so user resize/move finishes before placement or media callbacks reapply native position. Continuous placement must not lock the user's current size; explicit backend resize intents should come from page IPC such as `navigator.opentray.ipc.postMessage({ type: "resize", ... })`. Startup style and size recipes run once per session; repeated tray activation reveals the same panel with `toVisible()` and hides it with `close()`.

## Frameless Glass Utility

Use this when the page owns the full window chrome and the native background supplies blur/material.

Why: frameless removes OS controls, so the app must deliberately own drag regions, controls, and state. Native material is not CSS blur.

```ts
const window = tray.createWebviewWindow({
  html,
  nativeWindowApi: true,
  style: {
    frameless: true,
    resizable: true,
    keepOnTop: true,
    background: { kind: "semantic", token: "blur", state: "active" },
  },
});
await window.show();
```

Guidance: tell users to bind drag via native APIs where their UI intends dragging. Do not inject a drag strip into their HTML.
For Windows blur/material reviews, prefer `setBackground("blur", { state: "active" })` or an equivalent style recipe instead of treating transparency as a CSS problem.
When source `webview-control` and a package consumer feel different, inspect `windows-frameless.md`; do not compensate with page CSS or silently copy the source example's internal environment switch.

## Overlay Native Controls

Use this when native minimize/maximize/close controls should remain, but page content occupies titlebar space.

Why: overlay keeps the OS control cluster and lets the page adapt around real titlebar geometry.

```ts
const window = tray.createWebviewWindow({
  html,
  windowControlsOverlay: true,
  nativeWindowApi: true,
  style: { background: { kind: "semantic", token: "blur" } },
});
await window.show();
```

Page code should read overlay geometry and call `startAppRegionDrag()` for intentional drag areas. Avoid guessing titlebar control widths.

## Screen Corner Widget

Use this for small persistent utilities, desktop widgets, or companion status cards.

Why: screen placement is a WebView window composition concern. Keep it in `WebviewPlacementKit` unless multiple non-WebView consumers prove a shared core screen law.

```ts
await new WebviewPlacementKit({ screen: navigatorLikeScreen }).watch(window, {
  placement: "screen-bottom-right",
  width: 320,
  height: 180,
  placementMargin: 16,
});
```

## Top Island

Use this for compact live status near the top of a screen.

Why: this is still a WebView surface until the product needs a broker-level shared activity atom.

```ts
await new WebviewPlacementKit({ screen }).watch(window, {
  placement: "screen-top",
  width: 440,
  height: 72,
  placementMargin: 12,
});
```

## Native Framed Window

Use this when the app should feel like a normal desktop window.

Why: native chrome already handles title, drag, resize, accessibility, and platform conventions. Do not choose frameless unless the product needs custom chrome.

```ts
const window = tray.createWebviewWindow({
  html,
  title: "Status",
  icon: { type: "href", href: "/favicon.ico" },
  nativeWindowApi: true,
});
await window.show();
```
