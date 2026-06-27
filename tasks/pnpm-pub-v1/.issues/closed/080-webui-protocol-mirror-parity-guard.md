---
title: "WebUI protocol mirror lacked a parity guard"
state: closed
github_issue_status: closed
label: "protocol-contract"
---

## Summary
The WebUI intentionally mirrors daemon protocol types instead of importing runtime code into the Svelte bundle, but the mirror had no type-level regression guard against the shared daemon contracts.

## Impact
Chapters 3.2.2 and 5.2 define WebToken-gated WebSocket communication as a platform protocol. If the WebUI mirror drifts from `src/shared/index.ts`, the UI projection can silently stop matching the daemon ontology while both sides still look locally typed.

## Evidence
- `webui/src/lib/types.ts:1` documents that the WebUI protocol types are duplicated and must stay in sync with `src/shared/index.ts`.
- `test/unit/webui-protocol-types.test.ts:5` imports the daemon protocol contracts as type-only imports.
- `test/unit/webui-protocol-types.test.ts:15` imports the WebUI mirrored contracts as type-only imports.
- `test/unit/webui-protocol-types.test.ts:34` now asserts exact bidirectional type equality for the mirrored protocol surface.

## Resolution
- Added `test/unit/webui-protocol-types.test.ts` as a compile-time parity guard between shared daemon types and WebUI mirror types.
- Kept the WebUI runtime bundle unchanged by using type-only imports.
- Verified the focused parity test and root typecheck.

## Self-Review
- Task offset: this round improves protocol-contract verification without changing runtime daemon or WebUI behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
