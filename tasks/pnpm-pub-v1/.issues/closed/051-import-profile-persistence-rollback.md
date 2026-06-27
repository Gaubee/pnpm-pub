---
title: "Backup import left keychain credentials behind when profile persistence failed"
state: closed
github_issue_status: closed
label: "reliability"
---

## Summary
`/api/import` wrote imported token/TOTP credentials to the keychain before calling `store.upsertProfile()`, but it did not roll those keychain writes back if `profiles.json` persistence failed.

## Impact
Chapter 8.2 defines import as a closed loop: decrypt backup data, write Token/Secret to the system credential store, then update `profiles.json`. Without rollback, a failed profile write could leave orphan credentials with no profile source record, violating the same source-conservation law already enforced by onboarding.

## Evidence
- `src/daemon/web-server.ts:508-538` now wraps each imported profile write and rolls back imported credentials on failure.
- `src/daemon/web-server.ts:540-546` now deletes imported token/TOTP entries and memory credentials during rollback.
- `test/unit/web-server-renew.test.ts:301-335` proves a failed import persistence removes the imported keychain entries and leaves no memory/profile record.
- `spec/08.md:70-72` requires keychain writes and `profiles.json` update to be part of the same import flow.

## Resolution
- Added import rollback at the WebServer action boundary.
- On failure, delete imported keychain token/TOTP entries and clear corresponding in-memory credentials.
- Return a failed import result instead of leaving a successful-looking orphan credential state.

## Self-Review
- Task offset: this round tightened the import persistence law; it did not change the encrypted backup bundle format.
- Task residue: rollback is intentionally scoped to profiles imported in this request. It does not delete unrelated pre-existing profiles.
