---
title: "CLI stop socket mock used never casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI stop regression modeled the daemon socket by mutating an `EventEmitter` with four `as never` casts.

## Impact

Chapter 7.1.1 defines `pnpm-pub stop` as a thin-client IPC command. The regression should prove the stop frame and terminal acknowledgement without adding untyped mock wiring that weakens the test source of action.

## Evidence

- `test/unit/cli-stop.test.ts` now uses a local `CliStopMockSocket` `EventEmitter` subclass for the mocked socket behavior.
- `test/unit/cli-stop.test.ts` no longer contains `as never`.
- The focused stop regression still proves the CLI emits `{ command: 'stop' }` and prints the stop acknowledgement.

## Resolution

- Replaced method patching with a small typed socket mock class.
- Preserved the IPC frame recording and CLI output assertions.

## Self-Review

- Task offset: this round improves CLI stop test-source hygiene under the Chapter 7 thin-client law; it does not change CLI or daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
