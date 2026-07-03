---
title: "Renew flow could overwrite the stored TOTP secret"
state: closed
github_issue_status: closed
resolution: "Fixed by splitting /api/renew from onboarding and reusing the stored secret without writing an empty value back."
---

## Summary

`/api/renew` reused the onboarding path and could write an empty TOTP secret back into storage.

## Impact

The next publish after a renewal could fail because the profile secret had been blanked out.

## Evidence

- `webui/src/routes/renew/+page.svelte:23-33` now sends only `username`, `password`, and `manualToken`.
- `src/daemon/web-server.ts:387-435` resolves the stored secret explicitly and preserves it on renewal.
- `test/unit/web-server-renew.test.ts:73-98` verifies manual-token renew keeps the original secret intact.

## Resolution

Created a dedicated renewal path that reads the existing TOTP secret and only refreshes the token.
