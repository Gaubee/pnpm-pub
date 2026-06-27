---
title: "WebSocket server accepted unmasked client frames"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 145
resolution: "Fixed by rejecting unmasked inbound client frames before JSON dispatch."
---

## Summary

`src/daemon/ws.ts` accepted inbound WebSocket text frames even when the client mask bit was absent. Browser-origin WebSocket clients mask frames, so an unmasked inbound frame is transport input that has not satisfied the WebSocket protocol boundary.

## Impact

Chapters 3.2.2 and 5.2 define the WebUI WebSocket as the daemon's authenticated UI communication service. WebToken authentication proves channel authority, but the frame parser still has to enforce protocol shape before bytes can become daemon JSON messages.

## Evidence

- `spec/03.md:35` through `spec/03.md:43` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:31` defines the daemon WebSocket service.
- `src/daemon/ws.ts:95` reads the inbound frame mask bit.
- `src/daemon/ws.ts:96` now rejects unmasked inbound frames as invalid transport input.
- `test/unit/ws.test.ts:69` verifies an unmasked client text frame is rejected before `onMessage` dispatch.

## Resolution

The WebSocket parser now treats client masking as part of the transport law:

```text
client frame bytes
    |
    v
mask bit present? -- no --> invalid -> close
    |
   yes
    v
payload length + JSON parsing
```

This keeps raw wire bytes from becoming WebUI action facts unless they first satisfy the client-frame boundary.
