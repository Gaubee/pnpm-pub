---
title: "WebServer JSON API boundary leaks any and drops DELETE bodies"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

`WebServer` now decodes API request JSON through typed helpers, reads `DELETE` bodies, and rejects malformed import bundles before they reach daemon handlers.

## Impact

The daemon's HTTP action boundary now preserves TypeScript's runtime-safety contract. Profile deletion receives its source field from the request body, and malformed bundle projections are rejected as client errors instead of flowing into secret import logic.

## Evidence

- `src/daemon/web-server.ts:98-140` now reads request bodies for all non-GET API calls, decodes fields explicitly, and returns `400` for invalid payloads.
- `src/daemon/web-server.ts:111-120` reads `DELETE /api/profiles` from the request body instead of discarding it.
- `src/daemon/web-server.ts:501-518` now accepts a typed `BackupBundle` and passes it directly into the crypto import path.
- `src/daemon/web-server.ts:529-639` defines a typed JSON reader plus field-level decoders and a `BackupBundle` guard.
- `test/unit/web-server-renew.test.ts:237-270` covers DELETE body deletion and invalid import bundle rejection.

## Resolution

Decoded the HTTP boundary with typed helpers, removed the unsafe bundle cast, changed invalid payloads to `400`, and added regression coverage for the DELETE body path and malformed import bundles.
