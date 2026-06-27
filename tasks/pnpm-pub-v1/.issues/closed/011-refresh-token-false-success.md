---
title: "Refresh-token events resolve as success without refreshing"
state: closed
github_issue_status: closed
label: "events"
resolution: "Fixed by adding an action-required status and routing refresh-token confirmations into the renew affordance."
---

## Summary
The `refresh-token` proactive action resolves as `success` immediately, even though no token is refreshed and no credential re-apply flow is triggered.

## Impact
The Events hub shows a completed action that did not create the promised external effect. This violates conservation of source: the visible result claims token-refresh progress without a password/manual-token source of action.

## Evidence
- `spec/06.md:33` lists "强制刷新本地 Token" as a GUI-created Event action.
- `webui/src/routes/+page.svelte:54-63` creates a `refresh-token` Event from the New Action menu.
- `src/daemon/scheduler.ts:249-252` resolves that event as `success` and exits without calling `/api/renew`, collecting credentials, or routing the user to renew.
- `webui/src/lib/components/event-card.svelte:146-150` already has a renew affordance, but it only appears for `expired` events.
- `src/shared/index.ts:146` and `webui/src/lib/types.ts:59` now include the `action-required` event status.
- `src/daemon/scheduler.ts:249-253` now resolves `refresh-token` confirmation as `action-required` with a credential re-apply result message.
- `webui/src/lib/components/event-card.svelte:36-49` maps `action-required` to warning state.
- `webui/src/lib/components/event-card.svelte:138-152` labels refresh confirmation distinctly and exposes the renew affordance for both expired and action-required events.
- `test/unit/proactive-events.test.ts:144-164` verifies refresh-token confirmation does not call publish/OIDC writes and resolves to `action-required`.

## Resolution
Added an explicit `action-required` status and routed manual token-refresh Events into the existing renew flow instead of reporting false success.

## Self-Review
- Task drift: the fix changed event ontology rather than hiding the problem behind a success label or reusing `expired` for a non-expiry user action.
- Task residue: no known residual after root typecheck, Svelte check, focused proactive-events tests, and a grep check for stale false-success text.
