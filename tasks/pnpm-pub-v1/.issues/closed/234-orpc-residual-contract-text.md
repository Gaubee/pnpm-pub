---
title: "oRPC migration left stale REST and custom WebSocket contract text"
state: closed
github_issue_status: closed
label: cleanup
milestone: 230
resolution: fixed
---

## Summary

The oRPC migration removed the live REST/custom-WebSocket atoms, but active comments and specs still described the old WebUI protocol shape.

## Impact

Stale contract text can pull future changes back toward `/api/*` or hand-rolled WebSocket messages. The migration's platform law should name `/ws/rpc` oRPC WebSocket as the only WebUI action transport, with `/api/*` as a tombstone boundary.

## Evidence

- `spec/03.md`, `spec/04.md`, `spec/05.md`, and `spec/10.md` still referred to generic API/WS confirmation flows.
- `src/daemon/store.ts`, `src/daemon/web-server.ts`, `src/daemon/index.ts`, `src/shared/schemas.ts`, and `webui/src/lib/components/event-card.svelte` contained stale REST/custom-WS wording.
- `/api/*` returned the tombstone in production code, but `test/unit/orpc-websocket.test.ts` had no direct regression for that boundary.

## Resolution

Updated the active specs and comments to describe `/ws/rpc` oRPC WebSocket, `state.subscribe`, and `/api/*` tombstone behavior. Added a unit regression proving obsolete `/api/*` requests return `404` with `The WebUI API is served over /ws/rpc.`.
