---
title: "E2E exit-frame reader cast every IPC frame to IpcFrame"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish interception E2E `readExitFrame` helper cast every decoded frame to `IpcFrame` before checking for an exit response.

## Impact

Chapter 3.2.1 defines IPC requests and daemon responses as separate frame directions, and Chapter 7 requires the CLI to finish from the daemon exit frame. The E2E helper should prove the exit frame by guarding the shared frame union, not by treating every decoded request/response as an `IpcFrame`.

## Evidence

- `test/e2e/publish-intercept.test.ts` now defines `IpcExitEvidenceFrame` from the shared `IpcFrame` union.
- `readExitFrame` uses `isIpcExitFrame` to resolve only frames whose `type` is `exit`.
- The focused publish interception E2E still proves parked publish intent, WebToken-confirmed publish, bad-token rejection, and clock-drift recovery.

## Resolution

- Replaced the broad `as IpcFrame` assertion with a local exit-frame guard.
- Preserved the E2E publish interception behavior and daemon exit-code assertions.

## Self-Review

- Task offset: this round improves E2E IPC response evidence; it does not change runtime CLI, daemon, WebUI, or registry behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
