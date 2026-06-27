---
title: Daemon runtime catch paths cast unknown failures to Error
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/daemon/index.ts` projected runtime failures from `process.on('unhandledRejection')`, opentray mount, and tray placement through unchecked `Error` assertions. These values originate at process and native-adapter boundaries, so the ontology is `unknown` until proven.

## Impact

Non-`Error` rejections could collapse to `undefined` or erase the actual source text in daemon logs. That weakens the spec's source-conservation law for runtime failures and leaves a production `as Error` residue in the daemon bootstrap boundary.

## Evidence

- `src/daemon/index.ts:73` now logs unhandled rejections through `errorToLogMessage(reason)`.
- `src/daemon/index.ts:314` now logs opentray mount failures through `errorToLogMessage(err)`.
- `src/daemon/index.ts:372` now logs placement watch failures through `errorToLogMessage(err)`.
- `test/unit/daemon-logging.test.ts:71` verifies a non-`Error` opentray mount rejection keeps the original source text.
- `test/unit/daemon-logging.test.ts:88` verifies a non-`Error` placement rejection keeps the original source text.

## Resolution

Added one local daemon log projection helper:

```text
unknown runtime failure
    |
    v
instanceof Error ? message : String(value)
    |
    v
daemon log projection
```

The daemon bootstrap no longer uses unchecked `Error` assertions for runtime logging, and focused tests cover the native tray failure paths.

## Self-Review

Task offset: this round stayed on the unchecked assertion cleanup track and did not widen into daemon lifecycle refactors already present in the shared dirty tree.

Task residue: the CLI top-level catch residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
