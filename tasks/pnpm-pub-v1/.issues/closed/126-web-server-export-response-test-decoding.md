---
title: WebServer backup export test trusted response JSON through an assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`test/unit/web-server-renew.test.ts` decoded `/api/export` with `(await res.json()) as { ok: boolean; bundle?: ... }` before decrypting the returned backup bundle. Chapter 8.2 treats the backup bundle as credential migration source material, so even test evidence should decode daemon response JSON as `unknown` before using the encrypted bundle.

## Impact

The regression could pass while relying on an asserted response shape rather than proving that the daemon returned a valid backup wrapper. That weakened the test as evidence for the export/import credential migration law.

## Evidence

- `test/unit/web-server-renew.test.ts:68` now validates backup bundle structure with `isBackupBundle`.
- `test/unit/web-server-renew.test.ts:79` now promotes export response JSON through `parseExportResponse`.
- `test/unit/web-server-renew.test.ts:354` reads `res.json()` into `unknown`.
- `test/unit/web-server-renew.test.ts:355` decodes the response before using the bundle.
- `test/unit/web-server-renew.test.ts:360` decrypts only the decoded `BackupBundle`.

## Resolution

Replaced the asserted export response path with a test-local decoder:

```text
/api/export response JSON
    |
    v
unknown
    |
    v
parseExportResponse -> BackupBundle evidence
    |
    v
importBundle regression
```

The keychain-backed export test now verifies the response wrapper before decrypting it.

## Self-Review

Task offset: this round stayed inside the WebServer backup export regression and did not change production export/import behavior, encryption format, keychain persistence, or WebUI backup preview code.

Task residue: broader third-party and framework boundary casts remain in runtime and UI code, especially dynamic module imports and Svelte prop spreads. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
