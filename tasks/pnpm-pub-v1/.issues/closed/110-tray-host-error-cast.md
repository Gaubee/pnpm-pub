---
title: "Tray host opentray rejection paths assumed Error throws"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The tray host converted rejected opentray command failures with unchecked `Error` assertions.

## Impact
Chapter 6.4 treats opentray as an external runtime boundary. Broker, capability, or stale-session failures are source input from outside the daemon and are not guaranteed to be `Error` instances; asserting them as `Error` can erase the original rejection text in operational logs.

## Evidence
- `src/daemon/tray-host.ts:94` now logs safe-call rejections through `errorToLogMessage`.
- `src/daemon/tray-host.ts:167` now logs pending-pin `show()` failures through the same unknown-safe projection helper.
- `src/daemon/tray-host.ts:240` preserves normal `Error.message` behavior while stringifying non-`Error` thrown values.
- `test/unit/tray-host.test.ts:170` verifies a string rejection is preserved for both direct show and pending-pin failure logs.

## Resolution
- Replaced both unchecked `Error` assertions with an `unknown`-safe log projection helper local to the tray host atom.
- Added focused regression coverage for non-`Error` opentray command rejection text.

## Self-Review
- Task offset: this round strengthens tray-host failure projection only; it does not change KeepOnTop behavior, pending-event lifecycle, icon swapping, or opentray startup wiring.
- Task residue: the broader runtime catch paths named here were later resolved by `tasks/pnpm-pub-v1/.issues/closed/111-web-server-persistence-error-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/112-scheduler-write-error-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/114-daemon-runtime-error-cast.md`, and `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
