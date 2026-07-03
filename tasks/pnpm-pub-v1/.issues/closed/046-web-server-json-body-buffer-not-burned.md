---
title: "WebServer JSON body buffers were not burned after password-bearing requests"
state: closed
github_issue_status: closed
label: "security"
---

## Summary

`WebServer.readJson()` parsed HTTP JSON request bodies by concatenating raw request chunks and converting the result to a string, but it did not overwrite the raw `Buffer` copies after parsing. Chapter 8 requires password-bearing backend transport to use buffers where possible and burn them after use.

## Impact

Password-bearing requests such as `/api/renew`, `/api/add-profile`, `/api/export`, and `/api/import` left an extra raw HTTP body projection in memory beyond the endpoint-level string fields. That weakened the burn-after-read boundary for credentials and backup passwords.

## Evidence

- `src/daemon/web-server.ts:21` now imports the shared `burnBuffer()` primitive.
- `src/daemon/web-server.ts:537-557` now concatenates the JSON body into a tracked `bodyBuf` and burns both the concatenated body and source chunks in `finally`.
- `test/unit/web-server-renew.test.ts:211-237` proves a password-bearing `/api/renew` request triggers `Buffer.fill(0)` after parsing.
- `spec/08.md:10` states the backend should use `Buffer` for password transport where possible and overwrite it after use.

## Resolution

- Added raw JSON body burn-after-parse behavior at the WebServer boundary.
- Added a focused regression for a password-bearing renew request.

## Self-Review

- Task offset: this round tightened the HTTP parsing boundary only; it did not alter token application, crypto derivation, or endpoint payload schemas.
- Task residue: endpoint handlers still receive unavoidable JavaScript strings after JSON parsing. The transport buffers are now explicitly burned, while deeper string lifetime remains a runtime limitation rather than a separate source of truth.
