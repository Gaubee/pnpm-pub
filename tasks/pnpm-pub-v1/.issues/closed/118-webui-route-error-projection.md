---
title: WebUI route catch blocks cast unknown failures to Error
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

The add-profile, backup, and renew WebUI routes projected fetch/import/export failures through unchecked `Error` assertions. A route catch boundary receives `unknown` thrown values, so the route error ontology must be proven before it becomes visible UI text.

## Impact

Non-`Error` route failures could render `undefined` or erase the source text that explains why an add-profile, backup, or renew action failed. That weakens the WebUI's visible source conservation and leaves production Svelte route code dependent on unsafe TypeScript assertions.

## Evidence

- `webui/src/lib/error-projection.ts:1` now defines the shared route error projection helper.
- `webui/src/routes/add-profile/+page.svelte:50` projects add-profile catch failures through `errorToMessage`.
- `webui/src/routes/backup/+page.svelte:65` projects export catch failures through `errorToMessage`.
- `webui/src/routes/backup/+page.svelte:107` projects import catch failures through `errorToMessage`.
- `webui/src/routes/renew/+page.svelte:59` projects renew catch failures through `errorToMessage`.
- `test/unit/webui-error-projection.test.ts:11` verifies normal `Error` values still use `.message`.
- `test/unit/webui-error-projection.test.ts:15` verifies non-`Error` values preserve their source text.

## Resolution

Added one WebUI route projection atom:

```text
unknown route failure
    |
    v
Error ? message : String(value)
    |
    v
visible route error text
```

The affected Svelte routes no longer need unchecked `Error` assertions at catch boundaries.

## Self-Review

Task offset: this round stayed in the WebUI error-projection layer and did not change add-profile, backup, renew, daemon persistence, or HTTP API contracts.

Task residue: the unchecked assertion scan over live `src`, `webui/src`, and `test` code is clean for this lane; remaining scan hits are historical `TASKS.md` text. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
