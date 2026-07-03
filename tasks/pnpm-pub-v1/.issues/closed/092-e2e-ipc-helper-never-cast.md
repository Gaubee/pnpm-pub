---
title: "E2E IPC helper encoded requests through a never cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish interception E2E helper accepted `unknown` IPC payloads and passed them into `encodeFrame` through `as never`.

## Impact

Chapter 10.3 validates the full CLI-Daemon-WebUI-Registry loop, and Chapter 3.2.1 defines the IPC channel as compact JSON command frames. The E2E helper should emit the shared `IpcRequest` ontology directly instead of bypassing the frame contract with a type escape.

## Evidence

- `test/e2e/publish-intercept.test.ts` now imports `IpcRequest` from `src/shared/index.ts`.
- `sendIpc` accepts `IpcRequest` and passes it directly to `encodeFrame`.
- The focused publish interception E2E still proves parked publish intent, WebToken-confirmed publish, bad-token rejection, and clock-drift recovery.

## Resolution

- Replaced the `unknown` helper payload and `as never` cast with the shared IPC request contract.
- Preserved the E2E publish interception behavior and registry assertions.

## Self-Review

- Task offset: this round improves E2E IPC test-source hygiene; it does not change runtime CLI, daemon, WebUI, or registry behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
