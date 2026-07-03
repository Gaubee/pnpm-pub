---
title: "Renew failure could leave the credential pool mutated"
state: closed
github_issue_status: closed
resolution: "Fixed by restoring keychain entries and the in-memory credential pool to the exact previous state when renew persistence fails."
---

## Summary

`/api/renew` could write a candidate token into memory even when the renewal write failed.

## Impact

The next publish could execute with a token that was never durably committed, violating the spec's source-of-action and credential lifecycle boundaries.

## Evidence

- `src/daemon/web-server.ts:421-458` now restores the previous keychain token, previous TOTP secret, and in-memory credentials on failed renew persistence.
- `src/daemon/store.ts:123-139` exposes bounded credential deletion so failed renews can remove partial memory state instead of fabricating placeholder credentials.
- `test/unit/web-server-renew.test.ts:105-137` verifies a failed renew restores `old-token` and `SECRET`.

## Resolution

Made renew persistence transactional at the daemon boundary: only a fully persisted token/secret pair reaches the credential pool.
