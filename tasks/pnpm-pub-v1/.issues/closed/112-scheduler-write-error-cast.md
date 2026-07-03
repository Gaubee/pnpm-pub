---
title: "Scheduler write execution paths assumed Error throws"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish scheduler projected publish, placeholder, and OIDC execution failures through unchecked `Error` assertions.

## Impact

Chapters 3.3 and 8.3 define the scheduler as the physical confirmation wall: only after a confirmed pending event may it execute NPM writes or filesystem workflow writes. Failures at this boundary are source input from the registry, packer, filesystem, or runtime adapters and are not guaranteed to be `Error` instances; asserting them as `Error` can erase the actual failure text stored on the event and sent back to the CLI.

## Evidence

- `src/daemon/scheduler.ts:176` now defines a local `errorToMessage` projection helper.
- `src/daemon/scheduler.ts:359` now projects publish execution failures through the helper.
- `src/daemon/scheduler.ts:427` now projects placeholder execution failures through the helper.
- `src/daemon/scheduler.ts:473` now projects OIDC workflow-write failures through the helper.
- `src/daemon/scheduler.ts:489` now projects OIDC registry/setup failures through the helper.
- `test/unit/proactive-events.test.ts:204` verifies non-`Error` workflow-write failure text is preserved.
- `test/unit/proactive-events.test.ts:233` verifies non-`Error` OIDC registry setup failure text is preserved.
- `test/unit/proactive-events.test.ts:315` verifies non-`Error` placeholder packing failure text is preserved.
- `test/unit/proactive-events.test.ts:429` verifies non-`Error` publish packing failure text is preserved in both event result and CLI client projection.

## Resolution

- Replaced scheduler write-execution `Error` assertions with one local `unknown`-safe projection helper.
- Routed the existing workspace auto-collect catch through the same helper for consistency.
- Added focused regression coverage for non-`Error` rejection text across publish, placeholder, OIDC workflow-write, and OIDC registry setup paths.

## Self-Review

- Task offset: this round strengthens scheduler failure projection only; it does not alter pending-event authorization, credential lookup, package packing, OIDC workflow content, or registry write semantics.
- Task residue: the remaining daemon and CLI runtime catch residues were later resolved by `tasks/pnpm-pub-v1/.issues/closed/114-daemon-runtime-error-cast.md` and `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`; the avatar response-decoding cast was later resolved by `tasks/pnpm-pub-v1/.issues/closed/113-avatar-response-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
