---
title: "Export skips profiles whose credentials are only in keychain"
state: closed
github_issue_status: closed
label: "backup"
resolution: "Fixed by resolving export credentials from memory first and OS keychain second."
---

## Summary

`/api/export` only reads the in-memory credential pool. If a configured profile's credentials are present in the OS keychain but not loaded in memory, export skips that profile.

## Impact

The backup flow can produce an incomplete migration bundle even though the durable credential source still contains the profile secrets. This contradicts the spec's import/export source-of-truth boundary.

## Evidence

- `spec/08.md:47-55` says export should extract all Tokens and TOTP Secrets from OS Keychain before encrypting the backup.
- `src/daemon/web-server.ts:470-478` only reads `store.getCredentials(profile.username)` and pushes the profile into `skipped` when memory is empty.
- `src/daemon/web-server.ts:483-484` encrypts only the in-memory subset.
- `src/daemon/web-server.ts:19` now imports `getToken` alongside `getTotpSecret`.
- `src/daemon/web-server.ts:470-489` now resolves each profile from memory first, then keychain, and only skips incomplete credential pairs.
- `test/unit/web-server-renew.test.ts:210-234` verifies `/api/export` decrypts to the keychain-backed credential pair when memory is empty.

## Resolution

Export now treats OS keychain as the durable credential source when the memory pool lacks a complete profile credential pair.

## Self-Review

- Task drift: the fix stayed inside the export boundary and did not change the encrypted bundle format or import behavior.
- Task residue: no known residual after root typecheck, focused WebServer export regression, crypto/keychain/WebServer unit tests, and source grep for export credential resolution passed.
