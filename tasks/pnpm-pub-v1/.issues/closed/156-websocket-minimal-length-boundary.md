---
title: "WebSocket parser accepted non-minimal extended payload lengths"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 152
resolution: "Fixed by rejecting 16-bit and 64-bit extended length encodings when the decoded payload length belongs to a shorter WebSocket length form."
---

## Summary

`src/daemon/ws.ts` accepted small inbound text frames that used the 16-bit or 64-bit extended payload length markers even when the decoded payload length fit the shorter canonical WebSocket length form. That let non-canonical transport bytes become daemon JSON action candidates.

## Impact

Chapters 3.2.2 and 5.2 define a WebToken-gated WebUI WebSocket channel. WebToken proves authority, but the frame parser still owns the byte-level source boundary. Non-minimal length encodings are not a distinct UI action source; accepting them weakens the transport law before JSON action decoding.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:30` defines the daemon WebSocket service.
- `src/daemon/ws.ts:108` now decodes 16-bit extended lengths and rejects values below `126`.
- `src/daemon/ws.ts:113` now decodes 64-bit extended lengths and rejects values below `65536`.
- `test/unit/ws.test.ts:67` creates a masked text frame using a 16-bit extended marker for a small JSON payload.
- `test/unit/ws.test.ts:247` verifies the non-minimal text frame closes the connection before daemon dispatch.

## Resolution

Inbound frame length encoding now follows the minimal transport law:

```text
payload length < 126
    |
    v
single-byte length only

payload length 126..65535
    |
    v
16-bit extended length

payload length >= 65536
    |
    v
64-bit extended length
```

This keeps alternate wire projections from becoming equivalent daemon action sources.
