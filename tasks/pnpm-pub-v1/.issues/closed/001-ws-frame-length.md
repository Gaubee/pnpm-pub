---
title: "WebSocket frames over 125 bytes used broken length encoding"
state: closed
github_issue_status: closed
resolution: "Fixed in src/daemon/ws.ts by switching the extended-length branch to big-endian 16-bit encoding."
---

## Summary
`WebSocketConnection.write()` used the wrong byte layout for 126-byte frames.

## Impact
Any daemon snapshot or event payload over 125 bytes could be misparsed by the WebUI bridge.

## Evidence
- `src/daemon/ws.ts:111-140` now uses `bigEndian16(len)` for the extended-length branch.
- `test/unit/ws.test.ts:30-45` verifies a >125-byte frame decodes with the correct big-endian length.
- `test/e2e/publish-intercept.test.ts:204-232` still closes the publish loop successfully.

## Resolution
Replaced the `Uint16Array`-based header construction with `Buffer.writeUInt16BE`.
