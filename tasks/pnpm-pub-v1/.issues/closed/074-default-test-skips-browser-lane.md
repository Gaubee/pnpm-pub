---
title: "Default test command skipped the browser regression lane"
state: closed
github_issue_status: closed
label: "test-architecture"
---

## Summary
The renew browser regression had a dedicated `pnpm test:browser` lane, but `pnpm test` still ran only the unit Vitest config. That made the strongest default verification command skip the browser-backed WebUI title proof.

## Impact
Chapter 6.2 requires `Expired` and `Action Required` to remain separate credential-renewal sources. The default test gate should include the browser lane so the hydrated renew title projection is protected unless a caller deliberately chooses a narrower command.

## Evidence
- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `package.json:27` now runs `vitest run && pnpm test:browser` for `pnpm test`.
- `package.json:29` keeps `pnpm test:browser` available as the explicit browser-lane command.
- `vitest.config.ts:45` excludes `test/browser/**` from the unit Vitest lane so `pnpm test` does not duplicate browser tests.
- `vitest.browser.config.ts:8` owns `test/browser/**/*.test.ts`.
- `test/browser/renew-route-title.test.ts:127` asserts the three renew route title projections in a browser.

## Resolution
- Updated the root `test` script to run the unit lane followed by the browser lane.
- Preserved `test:browser` as the focused browser-lane command.
- Verified the full default gate with `pnpm test`.

## Self-Review
- Task offset: this round changes the default verification contract only; renew runtime behavior is unchanged.
- Task residue: `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
