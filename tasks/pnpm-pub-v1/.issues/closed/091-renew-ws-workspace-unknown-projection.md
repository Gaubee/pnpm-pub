---
title: "Renew WebSocket workspace regression used an unknown projection"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The renew WebSocket regression parsed daemon messages into a local `{ type: string; workspaces?: unknown[] }` shape instead of the shared WebSocket protocol contract.

## Impact

Chapter 3.2.2 and Chapter 5.2 define the WebSocket channel as the daemon-to-WebUI protocol surface. Keeping a local `unknown[]` projection in the regression weakened the evidence that profile-switch rebroadcasts still match the shared `WsServerMessage` ontology.

## Evidence

- `test/unit/web-server-renew.test.ts` now imports `WsServerMessage`, `Profile`, and `WorkspaceEntry` from `src/shared/index.ts`.
- The regression records a typed `RenewWsEvidenceMessage[]` for `profiles` and `workspaces` messages.
- The WebSocket parser validates profile and workspace message shapes before the test records them.

## Resolution

- Replaced the ad hoc `unknown[]` workspace projection with a typed shared-protocol evidence subset.
- Preserved the profile-switch rebroadcast assertion for the workspace snapshot and selected profile.

## Self-Review

- Task offset: this round improves WebSocket test-source hygiene; it does not change daemon or WebUI runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
