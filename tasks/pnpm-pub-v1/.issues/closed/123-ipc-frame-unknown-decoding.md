---
title: IPC frame reader promoted socket JSON through a union assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/shared/frame.ts` decoded newline-delimited socket JSON with `JSON.parse(line) as IpcRequest | IpcFrame`. Chapter 3.2 and Chapter 7 define IPC as a security and action-intent boundary, so transport bytes should enter the system as `unknown` and only become protocol ontology after explicit request/frame guards.

## Impact

Malformed socket JSON or structurally invalid frames could be typed as trusted IPC protocol data before the daemon or CLI validated the shape. That blurred the line between source input and protocol facts, and kept CLI response handling dependent on local casts.

## Evidence

- `src/shared/frame.ts:29` now drains complete JSON lines as `unknown`.
- `src/shared/frame.ts:40` contains malformed JSON inside the transport reader instead of throwing through the socket callback.
- `src/shared/frame.ts:48` exports `isIpcRequest` as the request promotion law.
- `src/shared/frame.ts:52` exports `isIpcFrame` as the daemon-response promotion law.
- `src/daemon/ipc-server.ts:101` validates each drained frame with `isIpcRequest` before dispatch.
- `src/cli/cli.ts:177` validates relay frames with `isIpcFrame` before writing terminal output or honoring exit codes.
- `src/cli/cli.ts:211` validates status response frames before projecting daemon status.
- `src/cli/cli.ts:283` validates start response frames before projecting success or failure.
- `test/unit/frame.test.ts:7` verifies partial reads, request promotion, response promotion, and malformed-frame rejection.

## Resolution

Replaced the asserted transport path with an explicit protocol boundary:

```text
socket bytes
    |
    v
FrameReader -> unknown
    |
    +--> isIpcRequest -> daemon action intent
    |
    +--> isIpcFrame   -> CLI terminal/status projection
```

Malformed JSON and invalid shapes no longer become typed IPC protocol objects.

## Self-Review

Task offset: this round stayed at the shared IPC framing boundary and its direct daemon/CLI consumers. It did not change scheduler semantics, pending event storage, HTTP/WS protocols, or registry write behavior.

Task residue: the remaining JSON assertion boundaries named here were later resolved by `tasks/pnpm-pub-v1/.issues/closed/124-crypto-decrypted-secret-decoding.md` and `tasks/pnpm-pub-v1/.issues/closed/125-package-version-manifest-decoding.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
