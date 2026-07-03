---
title: "CLI start socket mock used never casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI start regression modeled the daemon socket by mutating an `EventEmitter` with `as never` casts.

## Impact

Chapter 7.1.1 defines `pnpm-pub start [--profile=*]` as a thin-client IPC command. The regression should prove the start frame, profile override, daemon rejection, and terminal output without untyped mock wiring.

## Evidence

- `test/unit/cli-start.test.ts` now uses a local `CliStartMockSocket` `EventEmitter` subclass for the mocked socket behavior.
- `test/unit/cli-start.test.ts` no longer contains `as never`.
- The focused start regression still proves accepted and rejected profile paths through typed IPC frame recording.

## Resolution

- Replaced method patching with a small typed socket mock class.
- Preserved the IPC frame recording, daemon response simulation, and CLI output assertions.

## Self-Review

- Task offset: this round improves CLI start test-source hygiene under the Chapter 7 thin-client law; it does not change CLI or daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
