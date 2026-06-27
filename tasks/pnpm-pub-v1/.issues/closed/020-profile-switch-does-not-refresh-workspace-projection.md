---
title: "Profile switch does not refresh workspace projection"
state: closed
github_issue_status: closed
label: "workspace"
---

## Summary
`webui/src/lib/store.ts` clears workspace/package state when the user switches profile, but `src/daemon/web-server.ts` only persists the new default profile and does not push a fresh workspace/package snapshot back to the UI.

## Impact
The profile isolation law leaves the UI temporarily empty after a switch, even though the daemon already has enough information to recompute the scoped workspace view. That makes the workspace surface drift from the active profile until the user scans again.

## Evidence
- `webui/src/lib/store.ts:176-190` clears `workspaces`, `packages`, and `scannedRoot` on `selectProfile()`.
- `src/daemon/web-server.ts:260-263` only calls `store.setDefault(msg.username)` for `select-profile`.
- `src/daemon/web-server.ts:288-325` already knows how to recompute and broadcast the profile-scoped workspace projection.

## Recommendation
Have the profile-switch path trigger a fresh workspace projection broadcast for the new default profile so the UI is repopulated immediately after the switch.

## Resolution
Updated the WebSocket profile-switch flow to re-broadcast the current workspace snapshot after `select-profile`, and verified the UI receives the refreshed workspace projection in the WebUI/server regression.

## Self-Review
- Task drift: the fix stayed on the projection boundary and did not introduce a new workspace source of truth.
- Task residue: none after `pnpm typecheck` and `pnpm exec vitest run test/unit/web-server-renew.test.ts` passed.
