---
title: "Renew page described action-required credentials as expired tokens"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary
The Events card distinguished `expired` and `action-required`, but both states routed to `/renew`, whose header always said "The current token has expired." Credential re-apply cases therefore inherited the expired-token projection.

## Impact
Chapter 6.2 defines `Expired` and `Action Required` as separate credential-renewal sources. Collapsing both into expired-token copy weakened the UI projection and made missing-credential recovery look like an NPM token-expiry fact.

## Evidence
- `spec/06.md:25` defines `Expired` / `Action Required` as credential-renewal sources rather than ordinary failure projections.
- `webui/src/lib/components/event-card.svelte:171` now routes renewal with `reason=expired` or `reason=action-required`.
- `webui/src/lib/components/event-card.svelte:173` already labels the card action as either token expiration or credential input.
- `webui/src/routes/renew/+page.svelte:25` now derives the renew reason from the route query.
- `webui/src/routes/renew/+page.svelte:26` now renders a state-specific heading.
- `webui/src/routes/renew/+page.svelte:27` now renders state-specific intro copy.

## Resolution
- Threaded the Event status projection into the renew route as a `reason` query parameter.
- Updated the renew page copy so `action-required` says credentials are missing or need re-apply.
- Kept the backend renewal API and Event ontology unchanged.

## Self-Review
- Task offset: this round only fixes UI projection copy for the shared renew page.
- Task residue: the direct-route expired-token copy residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/066-renew-direct-route-expired-copy.md`.
