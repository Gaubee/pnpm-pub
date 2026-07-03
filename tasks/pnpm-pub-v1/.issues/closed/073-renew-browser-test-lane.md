---
title: "Renew browser regression lived in the unit test lane"
state: closed
github_issue_status: closed
label: "test-architecture"
---

## Summary

The renew document-title browser regression was committed, but it lived under `test/unit/`. That blurred the test lane boundary: unit tests should stay fast and process-local, while this regression starts the WebUI dev server and drives a browser process.

## Impact

Chapter 6.2 requires the renew route title projection to preserve `Expired` and `Action Required` as distinct sources. The browser proof is valid, but its source of action belongs to a browser/WebUI verification lane rather than the unit lane.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `package.json:29` now exposes `pnpm test:browser` as the dedicated browser regression command.
- `vitest.config.ts:45` now excludes `test/browser/**` from the unit test include set.
- `vitest.browser.config.ts:8` now owns `test/browser/**/*.test.ts`.
- `test/browser/renew-route-title.test.ts:51` starts the WebUI Vite dev server for the browser-backed title regression.
- `test/browser/renew-route-title.test.ts:127` asserts the three renew route title projections.

## Resolution

- Moved the renew title browser regression from `test/unit/` to `test/browser/`.
- Added `vitest.browser.config.ts` for browser-backed WebUI checks.
- Added `pnpm test:browser` and excluded browser tests from the unit config.

## Self-Review

- Task offset: this round only separates test lanes; renew runtime behavior and projection semantics are unchanged.
- Task residue: the default `pnpm test` gate was later updated to run the browser lane by `tasks/pnpm-pub-v1/.issues/closed/074-default-test-skips-browser-lane.md`.
