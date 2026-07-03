---
title: "Renew fallback could not recover a missing stored TOTP secret"
state: closed
github_issue_status: closed
resolution: "Fixed by accepting a supplied TOTP secret during renew and exposing that recovery field in the WebUI."
---

## Summary

When the stored TOTP secret was unavailable, the renew flow could not complete even if the user had fresh credential material.

## Impact

An expired-token event could become a dead end after keychain drift or partial credential loss, blocking the spec's token renewal path.

## Evidence

- `src/daemon/web-server.ts:399-435` now resolves the secret from memory, keychain, or a supplied renew payload before applying a token.
- `webui/src/routes/renew/+page.svelte:29-37` sends the optional TOTP secret with renew requests.
- `webui/src/routes/renew/+page.svelte:79-102` keeps the recovery TOTP field visible for both silent and manual renew modes.
- `test/unit/web-server-renew.test.ts:139-204` verifies both manual-token and password-based renews can recover with a supplied TOTP secret.

## Resolution

Kept the daemon's complete credential-pair law intact while giving the renew surface a real recovery path for missing stored secrets.
