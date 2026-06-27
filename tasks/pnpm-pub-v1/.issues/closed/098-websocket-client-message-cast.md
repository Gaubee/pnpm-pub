---
title: "WebSocket client messages were dispatched through an unchecked cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The WebUI WebSocket server cast every parsed client message to `WsClientMessage` before dispatching action handling.

## Impact
Chapter 3.2.2 makes the WebSocket channel a WebToken-gated action boundary. Authentication proves transport authority, but each message still needs to prove its protocol shape before it can select profiles, confirm events, scan workspaces, or create pending actions.

## Evidence
- `src/daemon/web-server.ts` now routes inbound messages through `handleClientMessage`.
- `isWsClientMessage` validates `auth`, `select-profile`, `confirm-event`, `reject-event`, `scan-workspace`, and `create-event` shapes before action dispatch.
- Invalid client messages receive an `Invalid WebSocket message.` toast and do not reach scheduler or store action paths.
- `test/unit/web-server-renew.test.ts` sends a malformed `create-event` over a token-authenticated WebSocket and verifies no event is created.

## Resolution
- Replaced the inbound `WsClientMessage` cast with explicit runtime guards.
- Preserved the existing WebToken upgrade gate, auth backstop, profile switch rebroadcast, and renew tests.

## Self-Review
- Task offset: this round strengthens the WebSocket action source boundary; it does not change WebSocket frame decoding or REST JSON body parsing.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
