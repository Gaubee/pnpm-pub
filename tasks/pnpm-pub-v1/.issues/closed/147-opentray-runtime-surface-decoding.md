---
title: "Opentray runtime surface was trusted through assertions"
state: closed
github_issue_status: closed
label: type-safety
milestone: 143
resolution: "Fixed by decoding opentray, WebView, tray, window, and placement-watch runtime surfaces before use."
---

## Summary

`src/daemon/index.ts` imported `opentray` and `@opentray/ext-webview` through unchecked assertions, then asserted the extended tray handle into the WebView-capable surface before mounting the tray-host atom.

## Impact

Chapters 5.2 and 6.4 depend on the daemon keeping IPC, HTTP, WebSocket, and tray hosting as bounded platform adapters. A malformed native module or handle could be projected as a valid tray/window source, weakening the headless-degradation law for environments where native WebView support is unavailable or partially loaded.

## Evidence

- `spec/05.md:19` through `spec/05.md:31` defines the daemon's core service boundary.
- `spec/06.md:51` through `spec/06.md:57` defines opentray as the tray host behavior layer.
- `spec/09.md:15` through `spec/09.md:20` keeps `opentray` as an external runtime dependency.
- `src/daemon/index.ts:271` now decodes dynamic opentray modules before use.
- `src/daemon/index.ts:289` now rejects malformed tray handles before constructing `TrayHost`.
- `src/daemon/index.ts:314` now rejects malformed WebView window handles before placement or lifecycle wiring.
- `test/unit/daemon-logging.test.ts:121` verifies malformed tray handles degrade to headless mode.
- `test/unit/daemon-logging.test.ts:143` verifies malformed WebView handles are not trusted.

## Resolution

Added local runtime guards for opentray module imports, WebView extension imports, extended tray handles, WebView window handles, placement kits, and placement watch teardown handles. The daemon now logs a bounded headless/unanchored degradation instead of treating unproven native adapter output as platform truth.
