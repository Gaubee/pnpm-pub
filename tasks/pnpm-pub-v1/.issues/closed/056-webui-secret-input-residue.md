---
title: "WebUI secret-bearing inputs lingered after successful actions"
state: closed
github_issue_status: closed
label: "security"
---

## Summary

Several WebUI flows sent secret-bearing values to the daemon and then left non-persisted sensitive input values in reactive state after the action completed.

## Impact

Chapter 8.1 defines password and credential inputs as read-after-burn material. The daemon owns durable storage and already burns transport buffers; the WebUI should also avoid keeping TOTP secrets, manual tokens, and protection passwords in page state after a terminal action response.

## Evidence

- `spec/01.md:45-47` defines automated credentials and password-protected migration as security-sensitive flows.
- `spec/08.md:7-10` requires one-time credential inputs and recommends burn-after-use handling.
- `webui/src/routes/add-profile/+page.svelte:35-39` now clears `totpSecret` and `manualToken` after successful profile creation.
- `webui/src/routes/renew/+page.svelte:39-43` now clears `manualToken` and recovery `totpSecret` after successful renewal.
- `webui/src/routes/backup/+page.svelte:56-62` now clears the export protection password after the daemon responds.
- `webui/src/routes/backup/+page.svelte:98-104` now clears the import protection password after the daemon responds.

## Resolution

- Kept the daemon/keychain as the source of durable credential truth.
- Added best-effort WebUI state cleanup at terminal action boundaries.
- Avoided protocol changes or compatibility branches.

## Self-Review

- Task offset: this round only reduces client-side secret residue in WebUI state after secret-bearing actions.
- Task residue: JavaScript strings may still exist transiently during request construction and browser GC; daemon-side buffer burning remains the stronger boundary.
