---
title: WebServer static MIME lookup asserted file extension keys
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/daemon/web-server.ts` served static WebUI files by casting `path.extname(file)` to `keyof typeof MIME`. Chapter 5.2.2 defines the daemon as the WebUI HTTP host, so static response projection should derive content type through an explicit lookup with fallback instead of asserting arbitrary filesystem extensions into the MIME map.

## Impact

The old cast was not a runtime bug by itself because the lookup already had a fallback, but it weakened the type boundary around static file projection and left a runtime-code assertion in a path that handles arbitrary built asset names.

## Evidence

- `src/daemon/web-server.ts:173` now writes the static response content type through `contentTypeFor(file)`.
- `src/daemon/web-server.ts:658` resolves content type from the file extension without casting the extension key.
- `src/daemon/web-server.ts:659` preserves `application/octet-stream` fallback for unknown extensions.
- `test/unit/web-server-renew.test.ts:368` verifies known CSS MIME projection and unknown-extension fallback through real HTTP responses.

## Resolution

Replaced the extension-key assertion with a narrow resolver:

```text
static file path
    |
    v
path.extname(filePath)
    |
    v
MIME lookup or application/octet-stream
```

Known WebUI assets keep their explicit MIME types, and unknown asset names fall back without a type assertion.

## Self-Review

Task offset: this round stayed at the WebServer static asset projection boundary and did not change API auth, WebSocket auth, SPA fallback routing, or WebUI build output.

Task residue: broader third-party/framework boundary casts remain outside this static serving path. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
