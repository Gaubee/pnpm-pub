---
title: "IPC server tests bypassed the socket boundary"
state: closed
github_issue_status: closed
label: "test-architecture"
---

## Summary

The IPC server regression reached into the private `dispatch` method with localized double-casts. That made the test prove private implementation behavior instead of the Chapter 3.2.1 socket protocol boundary.

## Impact

Chapter 3.2.1 defines the CLI/daemon pipe as the action-intent channel, and Chapter 7 depends on management commands and version handshakes flowing through that channel. Tests should exercise the public socket law instead of binding to private method shape.

## Evidence

- `test/unit/ipc-server.test.ts:30` now starts a real `IpcServer` through its public `start()` method.
- `test/unit/ipc-server.test.ts:37` sends encoded `IpcRequest` frames through `net.createConnection(socketPath())`.
- `test/unit/ipc-server.test.ts:80` narrows decoded frames through a typed `IpcFrame` guard.
- `test/unit/ipc-server.test.ts:105` verifies `start --profile` through the socket path.
- `test/unit/ipc-server.test.ts:166` verifies the newer-CLI handshake through the socket path.

## Resolution

- Removed private `dispatch` access from the IPC server tests.
- Replaced the fake socket with a public socket request helper using `encodeFrame`, `FrameReader`, and `socketPath()`.
- Kept the behavior coverage for start profile override, missing profile rejection, daemon-outdated handshake, and silent older-version handshake.

## Self-Review

- Task offset: this round improves test architecture and TypeScript safety without changing runtime IPC behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
