---
title: Event card status badge projection used an asserted variant map
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`webui/src/lib/components/event-card.svelte` mapped `event.status` to a badge variant through an inline object lookup followed by a union assertion. Chapter 6.2 defines event status as ontology; badge color is only projection and should be exhaustively derived from the status type without a cast.

## Impact

If a new `EventStatus` enters the WebUI mirror, an asserted projection map can drift silently. The card could compile while failing to give that status an intentional visual projection, weakening the Events Hub as the user-facing source of action and review.

## Evidence

- `webui/src/lib/components/event-card.svelte:7` now imports `EventStatus` for the projection map key.
- `webui/src/lib/components/event-card.svelte:9` now imports `BadgeVariant` from the badge atom.
- `webui/src/lib/components/event-card.svelte:24` defines `STATUS_VARIANTS` with `satisfies Record<EventStatus, NonNullable<BadgeVariant>>`.
- `webui/src/lib/components/event-card.svelte:45` derives `statusVariant` from the typed map without an assertion.
- `pnpm --filter ./webui check` passes.

## Resolution

Replaced the asserted inline projection with an exhaustive typed map:

```text
EventStatus ontology
    |
    v
Record<EventStatus, BadgeVariant>
    |
    v
Badge display projection
```

## Self-Review

Task offset: this round only strengthens the WebUI event status projection; it does not change event ontology, daemon event emission, or user interaction flow.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
