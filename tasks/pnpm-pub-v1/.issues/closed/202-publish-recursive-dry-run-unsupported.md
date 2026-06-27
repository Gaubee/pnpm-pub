---
title: recursive publish dry-run is blocked
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive publish arguments are currently rejected before the daemon distinguishes dry-run packing from registry writes.

## Impact

`spec/02.md` and `spec/07.md` require the CLI publish path to preserve native `pnpm publish` compatibility, while `spec/03.md` requires visible publish effects to pass through the physical confirmation wall. Blocking `pnpm-pub publish --recursive --dry-run` leaves the workspace publish atom undeveloped even though the operation can be implemented as a no-write multi-package packing projection.

## Evidence

- `src/daemon/scheduler.ts` rejects all recursive publish arguments with `Recursive publish is not yet supported by pnpm-pub; no registry write performed.`
- `src/daemon/workspace.ts` already exposes `findProjectRoot` and `scanWorkspace`, so workspace package discovery can be mounted through existing platform law.
- `test/unit/proactive-events.test.ts` only proves recursive publish avoids accidental single-package registry writes; it does not allow the no-write dry-run path.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 197 records full recursive/workspace publish as the remaining publish-parity residual.

## Resolution

Implemented recursive `--dry-run` as a workspace scan plus per-package pack path. Real recursive registry publish remains blocked until the daemon has a dedicated multi-package write transaction design.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
