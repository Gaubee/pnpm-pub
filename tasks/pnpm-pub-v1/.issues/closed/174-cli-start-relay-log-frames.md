---
title: CLI start relay dropped daemon log frames before the verdict
state: closed
github_issue_status: closed
label: cli
resolution: fixed
---

## Summary

`relayStart()` only consumed `status` and `exit` frames for `pnpm-pub start --profile`. The shared IPC protocol already defines `stdout` and `stderr` frames, so daemon log output sent before a start-profile verdict could be silently dropped on this management path.

## Impact

Chapter 7.2.4 defines the CLI as the daemon's terminal proxy for `stdout`, `stderr`, and final exit code. Dropping log frames on the start relay made terminal output a projection special case: publish preserved daemon output, while start-profile could hide source facts emitted through the same IPC frame law.

## Evidence

- `spec/07.md:39` requires daemon `stdout` and `stderr` to be proxied to the current terminal.
- `src/shared/index.ts:114` defines `IpcLogFrame` as part of the shared IPC frame ontology.
- `src/cli/cli.ts:284` now forwards `stdout` frames in `relayStart()`.
- `src/cli/cli.ts:286` now forwards `stderr` frames in `relayStart()`.
- `src/cli/cli.ts:288` and `src/cli/cli.ts:292` still treat daemon `status` and `exit` as the start verdict frames.
- `test/unit/cli-start.test.ts:8` now records typed `IpcFrame[]` responses for start-profile tests.
- `test/unit/cli-start.test.ts:117` proves daemon `stderr` sent before a rejected start-profile verdict reaches the CLI terminal projection.

## Resolution

The start-profile relay now follows the same IPC conservation law as publish:

```text
daemon IpcFrame
    |
    v
stdout/stderr passthrough
    |
    v
status or exit verdict
```

This keeps all daemon terminal output on the shared IPC contract and removes the stale need for ad hoc future management-frame print branches.

## Self-Review

Task offset: this round stayed inside the CLI management relay and its unit regression. It did not change daemon start-profile authority, status frame shape, or publish relay behavior.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
