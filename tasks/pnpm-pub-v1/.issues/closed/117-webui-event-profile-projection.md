---
title: WebUI event lists project sibling profile history
state: closed
github_issue_status: closed
label: webui
resolution: fixed
---

## Summary

Chapter 6.1 defines profile isolation for data, events, and workspaces, with Chapter 6.2 allowing a specific pending context-override exception for CLI commands that explicitly choose another profile. The WebUI derived `pendingEvents` and `historyEvents` directly from the global daemon event array, so resolved history from a sibling profile could appear under the currently selected profile.

## Impact

Sibling profile history is a projection leak. It does not change daemon event ontology, but it violates the user's selected identity boundary and can make past actions look attached to the wrong profile.

## Evidence

- `webui/src/lib/event-projection.ts:7` now defines the visibility law for an event under an active profile.
- `webui/src/lib/event-projection.ts:12` now sorts and filters the visible event projection.
- `webui/src/lib/store.ts:164` derives `visibleEvents` from daemon events plus `defaultProfile`.
- `webui/src/lib/store.ts:165` and `webui/src/lib/store.ts:166` derive pending/history from the profile-scoped projection instead of the global event list.
- `test/unit/event-projection.test.ts:23` verifies sibling profile history is hidden.
- `test/unit/event-projection.test.ts:33` verifies pending context overrides remain visible across profile boundaries.

## Resolution

Kept daemon event storage global and changed only the WebUI projection law:

```text
global event ontology
    |
    v
active profile + pending override exception
    |
    v
visible Events projection
```

Resolved sibling-profile history no longer appears in the active profile's Events list, while pending context overrides can still break isolation for explicit user confirmation.

## Self-Review

Task offset: this round stayed in the WebUI projection layer and did not change daemon event persistence, scheduler semantics, or WebSocket protocol shape.

Task residue: daemon still broadcasts global event snapshots; that is acceptable while the WebUI projection enforces the visible identity boundary, but server-side profile-scoped snapshots could become a future tightening. A separate WebUI route error-projection lane remains in `webui/src/routes/add-profile/+page.svelte`, `webui/src/routes/backup/+page.svelte`, and `webui/src/routes/renew/+page.svelte`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
