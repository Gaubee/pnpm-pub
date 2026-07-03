---
title: "Renew default error fallback ignored credential re-apply projection"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary

The renew page used route-specific heading, title, and submit-control copy, but when `/api/renew` returned a failure without an explicit message, the page still fell back to `Renew failed.`. Neutral credential re-apply routes should not invent an expired-token renewal failure.

## Impact

Chapter 6.2 treats `Expired` and `Action Required` as separate credential-renewal sources. Server-provided error messages remain source facts, but client fallback copy is projection and should follow the route source.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/src/routes/renew/+page.svelte:25` models the route reason as `expired`, `action-required`, or `direct`.
- `webui/src/routes/renew/+page.svelte:40` now derives the default fallback error from the route reason.
- `webui/src/routes/renew/+page.svelte:68` now uses that derived fallback only when the API provides no explicit error.

## Resolution

- Added a route-reason-derived default error fallback.
- Preserved `Renew failed.` only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on `Credential re-apply failed.` when no API error is returned.

## Self-Review

- Task offset: this round only fixes client fallback error copy; server-returned error facts are unchanged.
- Task residue: the rendered renew route-state browser evidence gap was later resolved by `tasks/pnpm-pub-v1/.issues/closed/170-renew-route-state-browser-regression.md`.
