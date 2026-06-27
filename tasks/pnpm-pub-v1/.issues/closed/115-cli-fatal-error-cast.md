---
title: CLI fatal catch casts unknown failures to Error
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/cli/cli.ts` projected the bin-entrypoint fatal catch through unchecked `Error` assertions. This catch receives rejected values from the top-level CLI promise, so its source ontology is `unknown` until proven.

## Impact

A non-`Error` rejection could lose the original failure text or print `undefined`, weakening terminal evidence for daemon/IPC startup failures. The CLI boundary should preserve the thrown source as terminal projection without weakening TypeScript safety.

## Evidence

- `src/cli/cli.ts:336` now defines `formatCliFatalError(error: unknown)`.
- `src/cli/cli.ts:396` now writes the fatal projection through that helper instead of `as Error`.
- `test/unit/cli-fatal-error.test.ts:8` verifies normal `Error` failures still prefer stack/message text.
- `test/unit/cli-fatal-error.test.ts:15` verifies non-`Error` failures preserve the original source text.

## Resolution

Added a bounded CLI fatal projection helper:

```text
unknown top-level rejection
    |
    v
Error ? stack/message : String(value)
    |
    v
stderr + exit(1)
```

The CLI entrypoint no longer needs unchecked `Error` assertions for fatal rejection reporting.

## Self-Review

Task offset: this round stayed on the type-safety cleanup track and did not change CLI command routing, IPC behavior, or daemon lifecycle law.

Task residue: the current unchecked assertion scan over `src` and `test` only reports historical task-ledger text. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
