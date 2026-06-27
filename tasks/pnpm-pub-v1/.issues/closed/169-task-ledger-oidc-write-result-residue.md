---
title: Older OIDC write-result residue stayed current after result closure
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestone 41 and issue `045-oidc-workflow-guard-after-registry-action.md` still described OIDC workflow write failures after a successful registry action as stderr-only while the registry result controlled Event success/failure. Issue 052 had already changed that behavior so local workflow artifact failure resolves the Event as `failed`.

## Impact

The task ledger is the LOOP source for future iterations. Leaving this stale partial-success residue as current would pull later work toward an already-corrected OIDC result boundary and blur the difference between the unavoidable external partial side effect and the local user-visible action result.

## Evidence

- `src/daemon/scheduler.ts:471` projects workflow write errors into `[oidc] could not write workflow: ...`.
- `src/daemon/scheduler.ts:473` resolves the Event as `failed` for that local artifact failure.
- `src/daemon/scheduler.ts:474` exits the waiting client with code `1`.
- `test/unit/proactive-events.test.ts:177` covers successful registry setup followed by workflow write failure.
- `test/unit/proactive-events.test.ts:200` asserts the Event status is `failed`.
- `test/unit/proactive-events.test.ts:201` asserts the workflow write failure is preserved in the Event result.
- `tasks/pnpm-pub-v1/.issues/closed/052-oidc-workflow-write-failure-false-success.md:20` records the original result-law closure.

## Resolution

Updated the older ledger projection:

```text
registry-side OIDC action
    |
    v
local workflow artifact write
    |
    v
Event result projection
```

Milestone 41 and issue 045 now point to the later issue 052 closure instead of describing write-failure result handling as current work.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change scheduler behavior, OIDC registry calls, workflow content, or `--force` semantics.

Task residue: registry-side OIDC may already be configured when the local workflow write fails. The Event reports that partial external side effect as a failed local action instead of success. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
