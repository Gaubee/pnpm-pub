---
title: WebSocket frame test used an asserted socket stub
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`test/unit/ws.test.ts` built the WebSocket socket double with `Object.assign(...) as SocketStub`. The test was proving Chapter 5.2.3 frame encoding, but its transport atom was still trusted by assertion instead of by a typed interface implementation.

## Impact

The WebSocket channel is part of the daemon communication substrate. Even in tests, unchecked socket-shape assertions weaken the evidence around frame transport because the mock can drift away from `SocketLike` without TypeScript catching it at the construction boundary.

## Evidence

- `test/unit/ws.test.ts:11` now defines `SocketStub` as a concrete `EventEmitter` class implementing `SocketLike`.
- `test/unit/ws.test.ts:12` keeps captured writes as owned state on the socket stub.
- `test/unit/ws.test.ts:28` returns the stub through the `SocketLike` interface without an assertion.
- `pnpm exec vitest run test/unit/ws.test.ts` passes.

## Resolution

Replaced the asserted object literal with a typed socket stub:

```text
SocketStub class
    |
    v
SocketLike interface
    |
    v
WebSocketConnection.write frame evidence
```

## Self-Review

Task offset: this round only strengthens the WebSocket frame test boundary; it does not change daemon runtime frame encoding or WebToken authentication behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
