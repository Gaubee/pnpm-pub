---
title: "WebSocket parser retained impossible one-byte close payloads"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 153
resolution: "Fixed by rejecting close frames whose decoded payload length is exactly one byte before waiting for mask or payload bytes."
---

## Summary

`src/daemon/ws.ts` rejected oversized close frames, but a close frame declaring a one-byte payload length was still treated as incomplete until mask and payload bytes arrived. A WebSocket close payload is either empty or begins with a two-byte status code, so a one-byte payload is already invalid as soon as the length is known.

## Impact

Chapters 3.2.2 and 5.2 define the daemon WebSocket as the WebToken-gated WebUI action channel. Invalid control-frame shape is not a valid source action and should not be retained as pending transport state. Keeping an impossible close frame open lets malformed bytes occupy the parser boundary instead of being rejected at the law boundary.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:30` defines the daemon WebSocket service.
- `src/daemon/ws.ts:121` now rejects close frames when `len === 1` or `len > 125`.
- `test/unit/ws.test.ts:51` creates a close-frame header declaring a one-byte payload.
- `test/unit/ws.test.ts:231` verifies the invalid close-frame header closes the connection before waiting for mask bytes.

## Resolution

Close-frame length validation now follows the control-frame source law:

```text
close length 0
    |
    v
valid empty close

close length >= 2 && <= 125
    |
    v
status code plus optional reason

close length 1 or > 125
    |
    v
invalid control frame, close transport
```

This keeps impossible close-frame source bytes from becoming retained parser state.
