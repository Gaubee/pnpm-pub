---
title: "Renew browser-title acceptance was not committed as a CI regression"
state: closed
github_issue_status: closed
label: "test-coverage"
---

## Summary

The renew route document-title distinction had manual `agent-browser` evidence, but no committed automated test. A future edit could break the hydrated browser title while unit projection tests still passed.

## Impact

Chapter 6.2 keeps `Expired` and `Action Required` as separate credential-renewal sources. Because the WebUI is served as a pure SPA, fetched HTML does not contain the hydrated document title; the regression must open the routed page in a browser and read `document.title`.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/vite.config.ts:6` documents the WebUI as a pure SPA served from static output.
- `package.json:57` now pins `agent-browser` as a dev dependency instead of relying on a global CLI.
- `test/unit/renew-route-title.test.ts:51` starts the WebUI Vite dev server on a free localhost port.
- `test/unit/renew-route-title.test.ts:115` opens each renew route with `agent-browser` and reads the browser title.
- `test/unit/renew-route-title.test.ts:127` asserts only `/renew?reason=expired` says `Renew Token · pnpm-pub`.

## Resolution

- Added `agent-browser@0.31.1` as a root dev dependency.
- Added `test/unit/renew-route-title.test.ts` as a committed browser-backed regression for expired, action-required, and direct renew route titles.
- Verified the focused regression with `pnpm exec vitest run test/unit/renew-route-title.test.ts`.

## Self-Review

- Task offset: this round only upgrades the renew title proof from manual acceptance to committed automated regression coverage.
- Task residue: the browser-backed regression was later moved into a dedicated WebUI/browser test lane by `tasks/pnpm-pub-v1/.issues/closed/073-renew-browser-test-lane.md` and added to the default test gate by `tasks/pnpm-pub-v1/.issues/closed/074-default-test-skips-browser-lane.md`.
