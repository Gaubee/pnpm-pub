---
title: "Direct renew route defaulted to expired-token copy"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary

After Event cards started routing renewal with explicit `reason=expired` or `reason=action-required`, direct visits to `/renew` still defaulted to expired-token copy. With no source Event in the URL, the page was inventing an expiration fact.

## Impact

Chapter 6.2 keeps `Expired` and `Action Required` as separate credential-renewal sources. A direct `/renew` visit has no Event status source, so it should present a neutral credential re-apply surface rather than projecting token expiry.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as credential-renewal sources rather than ordinary failure projections.
- `webui/src/lib/components/event-card.svelte:171` still sends explicit Event-backed reasons to `/renew`.
- `webui/src/routes/renew/+page.svelte:25` now models the no-reason route as `direct`.
- `webui/src/routes/renew/+page.svelte:32` now uses "Re-apply Credentials" for non-expired routes.
- `webui/src/routes/renew/+page.svelte:33` now uses neutral credential re-apply copy unless the reason is explicitly `expired`.
- `webui/src/routes/renew/+page.svelte:83` renders the derived state-specific copy.

## Resolution

- Added an explicit `direct` renew-route projection state.
- Preserved `reason=expired` as the only route that renders token-expired copy.
- Kept `reason=action-required` and direct visits on neutral credential re-apply copy.

## Self-Review

- Task offset: this round only fixes direct-route copy on the renew page.
- Task residue: the renew document-title residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/067-renew-document-title-projection.md`.
