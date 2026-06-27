---
title: "OIDC setup reported success when workflow file write failed"
state: closed
github_issue_status: closed
label: "reliability"
---

## Summary
`PublishScheduler.runOidc()` could call `configureOidc()` successfully, fail to write `.github/workflows/publish.yml`, log the write failure to stderr, and still resolve the Event as `success`.

## Impact
Chapter 1 and Chapter 8.5 define OIDC setup as both a registry-side binding and local reference workflow generation. Marking the Event green when the workflow artifact was not created made a failed visible result look successful.

## Evidence
- `src/daemon/scheduler.ts:448-456` now resolves the OIDC Event as `failed` and exits non-zero when workflow file creation fails.
- `test/unit/proactive-events.test.ts:168-194` proves that a successful registry call followed by workflow write failure leaves the Event failed.
- `spec/01.md:39-41` requires both one-click workflow generation and guarded file output.
- `spec/08.md:147-151` models OIDC setup as registry configuration followed by writing `publish.yml` before the WebUI marks completion.

## Resolution
- Made workflow write failure part of the OIDC action result instead of a stderr-only side note.
- Preserved the existing overwrite guard and registry-call ordering.
- Avoided a compatibility branch that would keep a false success projection.

## Self-Review
- Task offset: this round changes OIDC result semantics for local workflow write failure only.
- Task residue: registry-side OIDC may already be configured when the local write fails. The Event now reports that partial external side effect as a failed local action instead of success.
