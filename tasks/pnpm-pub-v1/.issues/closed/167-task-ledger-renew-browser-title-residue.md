---
title: Older renew browser-title residues stayed current after browser lane closure
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestones 66 through 69 and issues `071` through `073` still described the renew document-title proof as missing, manual-only, or outside the default test gate after later rounds had already committed the browser regression, moved it into `test/browser`, and added that lane to `pnpm test`.

## Impact

The task ledger is the source for the next LOOP iteration. Stale browser-title verification residue can pull future work toward already-closed evidence gaps and obscure the one remaining current boundary: Verdaccio/publish E2E still lives outside the default test gate.

## Evidence

- `package.json:27` runs `vitest run && pnpm test:browser` for `pnpm test`.
- `package.json:29` keeps the focused `pnpm test:browser` lane.
- `vitest.config.ts:45` excludes `test/browser/**` from the unit lane.
- `vitest.browser.config.ts:8` owns `test/browser/**/*.test.ts`.
- `test/browser/renew-route-title.test.ts:127` asserts the hydrated title for expired, action-required, and direct renew routes.
- `tasks/pnpm-pub-v1/.issues/closed/074-default-test-skips-browser-lane.md:31` records the original default test-gate closure.

## Resolution

Updated the older ledger projections:

```text
renew route title projection
    |
    v
browser regression in test/browser
    |
    v
pnpm test:browser
    |
    v
root pnpm test
```

Milestones 66 through 69 and issues 071 through 073 now point to the later closures instead of stating the browser-title evidence gap as current.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change renew runtime behavior, browser tests, or package scripts.

Task residue: `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
