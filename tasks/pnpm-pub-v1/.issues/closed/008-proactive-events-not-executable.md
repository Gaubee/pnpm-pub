---
title: "WebUI-created proactive events cannot be confirmed"
state: closed
github_issue_status: closed
label: "events"
resolution: "Fixed by adding a scheduler-owned proactive event API and routing WebUI create-event messages through it."
---

## Summary

The WebUI `create-event` path writes a pending event into the store but never registers it with the scheduler's executable pending map.

## Impact

Workspace actions such as "Publish" and "OIDC" can render as pending cards, but clicking confirm cannot execute them because `PublishScheduler.confirm()` only looks up events registered through CLI interception.

## Evidence

- `src/daemon/web-server.ts:320-329` calls `store.createEvent()` directly for WebUI-created events.
- `src/daemon/scheduler.ts:44-101` keeps executable pending events in a private map that is only populated by `intercept()`.
- `src/daemon/scheduler.ts:102-104` returns `false` when a confirmed event id is not in that pending map.
- `webui/src/routes/workspaces/+page.svelte:142-156` exposes Publish and OIDC actions through the affected `actions.createEvent()` path.
- `src/daemon/scheduler.ts:72-161` now validates proactive payloads into typed event ontology before mounting them.
- `src/daemon/scheduler.ts:210-222` now registers WebUI-created events in the executable pending map.
- `src/daemon/web-server.ts:320-332` now delegates WebUI `create-event` handling to the scheduler instead of directly writing store state.
- `test/unit/proactive-events.test.ts:43-89` proves a WebUI-style OIDC event confirms through the pending wall and rejects invalid payloads without creating an event.

## Resolution

Moved proactive event creation behind `PublishScheduler.createProactiveEvent()`, preserving the same pending-wall execution law for CLI and WebUI action sources.

## Self-Review

- Task drift: the fix stayed at the scheduler/platform boundary; it did not patch the Workspaces button or fabricate a UI-only success projection.
- Task residue: no known residual for issue 008 after `pnpm typecheck`, focused unit tests, and publish-intercept E2E passed.
