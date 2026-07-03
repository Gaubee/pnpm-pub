---
title: "Renew submit button ignored credential re-apply projection"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary

The renew page heading, intro, and document title already distinguished expired-token renewal from neutral credential re-apply routes, but the submit button still always said `Renew token`. That left one visible control projecting token expiry onto `action-required` and direct routes.

## Impact

Chapter 6.2 treats `Expired` and `Action Required` as distinct credential-renewal sources. A direct or action-required route should not present its primary action as expired-token renewal when the source only requires credentials to be re-applied.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/src/routes/renew/+page.svelte:25` models the route reason as `expired`, `action-required`, or `direct`.
- `webui/src/routes/renew/+page.svelte:38` now derives the idle submit label from the route reason.
- `webui/src/routes/renew/+page.svelte:39` now derives the busy submit label from the route reason.
- `webui/src/routes/renew/+page.svelte:120` now renders the derived submit label instead of a hard-coded renew-token label.

## Resolution

- Added state-specific idle and busy submit labels.
- Preserved `Renew token` / `Renewing…` only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on `Re-apply credentials` / `Re-applying…`.

## Self-Review

- Task offset: this round only fixes the primary submit-control copy on the renew page.
- Task residue: the renew default-error fallback residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/069-renew-default-error-projection.md`.
