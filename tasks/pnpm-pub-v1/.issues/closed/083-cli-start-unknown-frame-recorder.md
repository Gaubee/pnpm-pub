---
title: "CLI start regression recorded IPC frames as unknown values"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The CLI start regression stored emitted IPC frames in `unknown[]` and manually parsed newline-delimited JSON as `{ command?: string }`, even though the repository already has a public `FrameReader` and `IpcRequest` contract for the CLI/daemon pipe.

## Impact
Chapter 7.1.1 treats `start [--profile=*]` as a management command over the IPC protocol. Recording untyped frames weakened the test's evidence: the test asserted a projection of manual JSON parsing instead of the typed IPC request ontology.

## Evidence
- `test/unit/cli-start.test.ts:7` now imports the shared `FrameReader`.
- `test/unit/cli-start.test.ts:8` now imports the shared `IpcFrame` and `IpcRequest` protocol types.
- `test/unit/cli-start.test.ts:13` now stores typed `IpcRequest[]` frames.
- `test/unit/cli-start.test.ts:23` now decodes emitted socket chunks through `FrameReader`.
- `test/unit/cli-start.test.ts:64` and `test/unit/cli-start.test.ts:87` now name the regressions in Given/When/Then scenario form.

## Resolution
- Replaced the `unknown[]` frame recorder with typed IPC request recording.
- Reused the shared frame reader instead of hand-parsing newline-delimited JSON in the test.
- Renamed the focused regressions with BDD-style scenario names.
- Verified the focused CLI start regression and project typecheck.

## Self-Review
- Task offset: this round improves the test evidence boundary for an existing CLI management atom; it does not change CLI runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
