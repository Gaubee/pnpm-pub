---
title: "Risky workspace confirmation used the path as the token"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary

Risky workspace confirmation staged the workspace entry correctly, but the confirmation token was the raw filesystem path. That made the path both ontology and authority, so `/api/workspace/confirm` could be driven by a predictable value instead of an explicit runtime confirmation capability.

## Impact

Chapter 5.3.2 says a risky directory must not be written until the user explicitly confirms it. Reusing the path as the token blurred the staged source record with the confirmation authority and weakened the risk-boundary state machine.

## Evidence

- `spec/05.md:40` requires a warning/confirmation flow when no Git or NPM project marker is found.
- `spec/05.md:41` says the path is written only after explicit confirmation.
- `src/daemon/store.ts:169` now documents the staged confirmation token as opaque.
- `src/daemon/store.ts:171` now generates the token with `randomUUID()`.
- `src/daemon/store.ts:172` now keys the pending map by that token instead of the path.
- `test/unit/store.test.ts:95` proves staging no longer returns the path as the token.
- `test/unit/store.test.ts:106` proves confirming by raw path fails while confirming by opaque token persists once.

## Resolution

- Changed risky workspace staging to return a per-stage opaque runtime token.
- Kept the existing WebUI/API message shape unchanged: clients still receive a `riskyConfirmationToken`, but it is no longer the path itself.
- Added regression coverage for non-persistence before confirmation, failed raw-path confirmation, and single-use opaque-token confirmation.

## Self-Review

- Task offset: this round only hardens the risky workspace confirmation capability boundary.
- Task residue: staged tokens remain process-local and are not persisted across daemon restarts, which matches the current in-memory confirmation model but means a restart clears outstanding risky workspace confirmations.
