---
title: "Write-capable Events treated missing credentials as failed"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary

Write-capable Events without loaded credentials resolved as `failed` before any package, placeholder, or OIDC write was attempted. That presented a credential re-apply need as a completed failed action instead of preserving the renewal source.

## Impact

Chapter 6.2 defines `Action Required` as a first-class credential-renewal state and says it must not degrade into a normal failure projection. Missing credentials are a pre-execution credential state, so the Event should point the user to re-apply credentials while keeping NPM writes blocked.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as credential-renewal sources rather than ordinary failure projections.
- `src/daemon/scheduler.ts:261` still checks the credential pool before dispatching write-capable Event kinds.
- `src/daemon/scheduler.ts:264` now resolves missing credentials as `action-required`.
- `src/daemon/scheduler.ts:265` still returns a non-zero CLI exit path for blocked terminal workflows.
- `test/unit/proactive-events.test.ts:251` proves a write-capable placeholder Event without credentials resolves as `action-required`.
- `test/unit/proactive-events.test.ts:268` proves no pack, publish, or OIDC registry action runs without credentials.

## Resolution

- Changed the scheduler credential wall to resolve missing credentials as `action-required`.
- Preserved the no-write safety boundary by returning before pack, publish, placeholder, or OIDC execution.
- Added focused regression coverage for a write-capable Event without credentials.

## Self-Review

- Task offset: this round only changes the scheduler's missing-credential Event status; it does not change renewal API behavior.
- Task residue: the WebUI action-required renew copy residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/065-renew-page-action-required-copy.md`.
