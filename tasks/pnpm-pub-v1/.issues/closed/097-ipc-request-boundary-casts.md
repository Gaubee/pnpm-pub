---
title: "IPC request boundary trusted decoded frames through casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The daemon IPC server cast every decoded socket frame to `IpcRequest` before dispatching it.

## Impact

Chapter 3.2.1 says the CLI socket is an intent channel, not an authorization channel. A decoded frame must prove it is a valid handshake, publish request, or management request before it can trigger scheduler behavior or daemon lifecycle actions.

## Evidence

- `src/daemon/ipc-server.ts` now gates decoded frames with `isIpcRequest`.
- Publish requests must provide `command: "publish"`, string `cwd`, string-array `args`, and an optional string `profileOverride`.
- Handshake and management requests are narrowed through dedicated guards before dispatch logic reads their fields.
- `test/unit/ipc-server.test.ts` sends a malformed publish frame over the real socket and verifies the daemon returns `invalid IPC request` without creating any event.

## Resolution

- Replaced broad decoded-frame and dispatch-time IPC casts with explicit runtime request guards.
- Preserved existing start/profile and version-handshake behavior.

## Self-Review

- Task offset: this round strengthens the IPC source-of-action boundary; it does not change WebSocket parsing or JSON frame parsing.
- Task residue: the WebSocket client-message boundary named here was later resolved by `tasks/pnpm-pub-v1/.issues/closed/098-websocket-client-message-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
