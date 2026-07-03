---
title: "OIDC setup checked the workflow overwrite guard after the registry action"
state: closed
github_issue_status: closed
label: "scheduler"
---

## Summary

`PublishScheduler.runOidc()` called `configureOidc()` against the NPM registry before checking whether `.github/workflows/publish.yml` already existed locally. Chapter 1 says generated OIDC workflow output is reference-only and must not overwrite an existing file unless `--force` is supplied.

## Impact

When a workflow already existed without `force`, the scheduler could perform the external registry-side OIDC action and only then fail the local workflow guard. That violated conservation of source: a user-visible failure could still leave an external NPM-side effect behind.

## Evidence

- `src/daemon/scheduler.ts:428-443` now computes the target workflow path and blocks existing files before any registry call.
- `src/daemon/scheduler.ts:445-446` now calls `configureOidc()` only after the local overwrite guard passes.
- `test/unit/proactive-events.test.ts:139-165` proves an existing workflow without `force` does not call `configureOidc()`, does not overwrite the file, and resolves the Event as failed.
- `spec/01.md:40-41` defines the OIDC workflow file as guarded reference output that must not be blindly overwritten.

## Resolution

- Moved the local workflow overwrite guard ahead of the NPM registry OIDC mutation.
- Added a regression that makes the source-of-action ordering explicit.

## Self-Review

- Task offset: this changes OIDC setup ordering only; it does not change workflow content, Trusted Publish API shape, or `--force` semantics.
- Task residue: the workflow write-failure result residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/052-oidc-workflow-write-failure-false-success.md`.
