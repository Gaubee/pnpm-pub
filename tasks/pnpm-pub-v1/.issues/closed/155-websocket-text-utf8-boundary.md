---
title: "WebSocket text frames rewrote invalid UTF-8 before JSON dispatch"
state: closed
github_issue_status: closed
label: protocol-boundary
milestone: 151
resolution: "Fixed by decoding text-frame payloads with a fatal UTF-8 decoder before JSON parsing."
---

## Summary

`src/daemon/ws.ts` decoded text-frame payloads with `Buffer.toString('utf8')`, which can replace invalid bytes with the replacement character. If the rest of the payload still looked like JSON, malformed source bytes could become a daemon message with rewritten text.

## Impact

Chapters 3.2.2 and 5.2 define a WebToken-gated WebUI WebSocket channel. A text frame's bytes are the source record for daemon action decoding; invalid UTF-8 should not be projected into replacement-character text and then treated as a valid JSON action. That blurs source conservation at the transport boundary.

## Evidence

- `spec/03.md:33` through `spec/03.md:40` defines the WebToken-authenticated WebUI communication boundary.
- `spec/05.md:28` through `spec/05.md:30` defines the daemon WebSocket service.
- `src/daemon/ws.ts:12` now creates a fatal UTF-8 `TextDecoder`.
- `src/daemon/ws.ts:78` now decodes text payloads through the strict decoder before JSON parsing.
- `src/daemon/ws.ts:163` now returns `null` for invalid UTF-8 text payloads.
- `test/unit/ws.test.ts:71` creates a JSON-looking masked text frame containing invalid UTF-8 bytes.
- `test/unit/ws.test.ts:218` verifies invalid UTF-8 closes the connection before daemon dispatch.

## Resolution

Text-frame decoding now follows the source boundary:

```text
valid UTF-8 text payload
    |
    v
JSON action decoder

invalid UTF-8 payload
    |
    v
close transport before source bytes are rewritten
```

This keeps malformed text bytes from becoming replacement-character daemon actions.
