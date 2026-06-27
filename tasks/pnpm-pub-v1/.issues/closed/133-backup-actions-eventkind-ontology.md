---
title: REST backup actions leaked into WebSocket EventKind ontology
state: closed
github_issue_status: closed
label: protocol
resolution: fixed
---

## Summary

Chapter 8.2 defines backup import/export as token-guarded REST flows, and the shared WebSocket protocol already documents that import/export are not WS verbs. The runtime ontology still included `import` and `export` in `EventKind`, so `/api/export` and `/api/import` facts could be mis-projected as confirmable Event Hub actions.

## Impact

The daemon accepted `create-event` messages with `kind: "export"` as structurally valid, then relied on the scheduler payload parser to reject them as unsupported. That makes a REST-only action look like a valid Event atom at the protocol boundary and weakens the Chapter 3.3 pending-wall model.

## Evidence

- `src/shared/index.ts:138` now defines `EventKind` as the four confirmable Event Hub actions only: `publish`, `setup-oidc`, `create-placeholder`, and `refresh-token`.
- `src/shared/index.ts:238` keeps `create-event` tied to that narrowed `EventKind`.
- `src/daemon/web-server.ts:666` now validates WebSocket event creation against the same narrowed action set.
- `webui/src/lib/ws-message.ts:12` mirrors the same valid event-kind set for browser-side server-message decoding.
- `test/unit/web-server-renew.test.ts:512` proves `kind: "export"` is rejected as an invalid WebSocket action before any Event is created.
- `test/unit/webui-ws-message.test.ts:48` proves a server-side `export` event projection is rejected by the WebUI decoder.

## Resolution

Removed backup import/export from the Event Hub ontology instead of keeping a runtime compatibility branch:

```text
backup import/export
    |
    v
token-guarded REST API

confirmable action
    |
    v
WebSocket create-event -> Event Hub pending wall
```

## Self-Review

Task offset: this round only narrows the EventKind protocol ontology. It does not change backup REST API behavior, backup encryption, or Event execution semantics for publish/OIDC/placeholder/refresh.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
