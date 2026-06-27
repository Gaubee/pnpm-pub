---
title: WebUI create-event helper accepted untyped payloads
state: resolved
github_issue_status: closed
label: type-safety
milestone: 177
resolution: fixed
---

## Summary

The WebUI `actions.createEvent()` helper accepted `payload: unknown`, even though each Event kind already has a concrete payload ontology in the shared protocol.

## Impact

This left WebUI atoms able to compose invalid proactive Event payloads until the daemon rejected them. The daemon boundary must still decode untrusted wire data, but the in-process WebUI helper should conserve source shape at compile time.

## Evidence

- `webui/src/lib/store.ts` previously exposed the local helper as `createEvent(kind, payload: unknown)`.
- Callers in `webui/src/routes/+page.svelte` and `webui/src/routes/workspaces/+page.svelte` pass concrete payloads for `publish`, `setup-oidc`, `create-placeholder`, and `refresh-token`.
- The shared protocol already models these shapes through `EventPayload` in `src/shared/index.ts`.

## Resolution

- Added `EventPayloadData<K extends EventKind>` to the shared protocol and WebUI mirror.
- Changed `webui/src/lib/store.ts` so `actions.createEvent()` requires the payload shape matching the concrete Event kind.
- Extended `test/unit/webui-protocol-types.test.ts` to keep the WebUI mirror's per-kind payload data mapping aligned with the daemon protocol.
- Verified with focused protocol tests, WebUI Svelte check, root typecheck, task-ledger validation, and diff hygiene.
