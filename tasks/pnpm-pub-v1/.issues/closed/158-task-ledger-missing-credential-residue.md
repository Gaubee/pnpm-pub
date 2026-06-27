---
title: "Task ledger still claimed missing credentials failed write-capable Events"
state: closed
github_issue_status: closed
label: task-ledger
milestone: 154
resolution: "Fixed by updating the stale Milestone 59 and issue 063 residuals to point at the Milestone 60 credential-status fix."
---

## Summary

`tasks/pnpm-pub-v1/TASKS.md` and issue `063-refresh-token-requires-old-credentials.md` still said write-capable Events without credentials resolved as `failed`. That was true when the refresh-token round closed, but it became stale after issue 064 and Milestone 60 changed the scheduler credential wall to resolve the same condition as `action-required`.

## Impact

The task ledger is the iteration source for this LOOP workflow. A stale residual can pull later rounds toward an already-closed problem and make the issue folder act like a competing source of truth instead of a review ledger. Chapter 6.2 defines `Action Required` as credential-renewal ontology, so the ledger should reflect the current source behavior.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as credential-renewal states rather than ordinary failure projections.
- `src/daemon/scheduler.ts:271` checks credentials before dispatching write-capable Event execution.
- `src/daemon/scheduler.ts:274` resolves missing credentials as `action-required`.
- `test/unit/proactive-events.test.ts:336` proves a write-capable placeholder Event without credentials requires credential input.
- `tasks/pnpm-pub-v1/.issues/closed/064-write-events-missing-credentials-failed.md:22` records the runtime fix.
- `tasks/pnpm-pub-v1/TASKS.md:1033` now points Milestone 59's residual at the Milestone 60 resolution instead of saying the behavior still fails.
- `tasks/pnpm-pub-v1/.issues/closed/063-refresh-token-requires-old-credentials.md:29` now points at issue 064 as the resolved follow-up.

## Resolution

Updated the stale task artifacts so the ledger now conserves to the current implementation:

```text
old residual
    |
    v
Milestone 60 / issue 064 runtime fix
    |
    v
current ledger note: resolved as action-required
```

This round changed task evidence only; runtime behavior was already correct.
