---
title: WebUI WebSocket store accepts raw payloads by assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`webui/src/lib/store.ts` decoded daemon WebSocket frames with `JSON.parse(ev.data as string) as WsServerMessage`. The WebSocket transport source is raw `unknown` data until it is parsed and proven against the daemon protocol shape.

## Impact

A malformed or non-string frame could cross the WebUI protocol boundary as trusted store state. That blurs the Chapter 3.2.2 WebToken-authenticated protocol law: transport data is source input, while Svelte store state is a projection that must only receive validated protocol facts.

## Evidence

- `webui/src/lib/ws-message.ts:16` now decodes raw transport data through `parseWsServerMessage`.
- `webui/src/lib/ws-message.ts:26` now checks the server message discriminant before accepting a frame.
- `webui/src/lib/ws-message.ts:65` now validates `PubEvent` shape before events reach store state.
- `webui/src/lib/store.ts:99` now calls `parseWsServerMessage(ev.data)` instead of asserting the parsed payload.
- `test/unit/webui-ws-message.test.ts:10` covers the WebUI WebSocket decoder.
- `test/unit/webui-ws-message.test.ts:24` rejects non-string transport data.
- `test/unit/webui-ws-message.test.ts:30` rejects malformed event frames.

## Resolution

Inserted an explicit WebUI protocol decoder:

```text
MessageEvent.data
    |
    v
JSON parse + WsServerMessage guard
    |
    v
Svelte store state
```

The store no longer treats raw WebSocket input as trusted daemon protocol data by assertion.

## Self-Review

Task offset: this round stayed at the WebUI WebSocket protocol boundary and did not change daemon message emission, WebToken auth, or Svelte store projections after a message is accepted.

Task residue: the WebUI REST response boundary named here was later resolved by `tasks/pnpm-pub-v1/.issues/closed/120-webui-rest-response-decoding.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
