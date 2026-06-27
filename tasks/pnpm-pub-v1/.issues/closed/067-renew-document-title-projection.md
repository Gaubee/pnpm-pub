---
title: "Renew document title ignored credential re-apply projection"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary
The renew page body already distinguished `expired`, `action-required`, and direct visits, but the document title still always said `Renew Token`. That left a stale expired-token projection in browser chrome for neutral credential re-apply routes.

## Impact
Chapter 6.2 keeps `Expired` and `Action Required` as separate credential-renewal sources. The page title is projection only, so it should not invent token expiry when the route source is `action-required` or direct.

## Evidence
- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/src/routes/renew/+page.svelte:25` models the route reason as `expired`, `action-required`, or `direct`.
- `webui/src/routes/renew/+page.svelte:32` derives "Renew Token" only for explicit expired-token routes and "Re-apply Credentials" otherwise.
- `webui/src/routes/renew/+page.svelte:76` now renders the document title from the same derived heading.

## Resolution
- Changed the renew route document title to use `{heading} · pnpm-pub`.
- Kept expired-token title copy only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on neutral credential re-apply title copy.

## Self-Review
- Task offset: this round only fixes browser-title projection for the renew page.
- Task residue: the renew submit-button residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/068-renew-submit-button-projection.md`.
