---
title: "Start profile override lacks IPC regression"
state: closed
github_issue_status: closed
label: "identity"
---

## Summary
`src/cli/cli.ts` and `src/daemon/ipc-server.ts` implement `pnpm-pub start --profile=...`, but there is no direct regression proving the IPC management frame reaches the daemon and triggers `onStart(profileOverride)`.

## Impact
The profile-selection authority path is part of the daemon bootstrap law. Without a regression, the override could silently disappear on the IPC boundary and the daemon would start under the wrong identity.

## Evidence
- `src/cli/cli.ts:240-250` sends `IpcManagementRequest` with `profileOverride`.
- `src/daemon/ipc-server.ts:160-172` applies `onStart` when `profileOverride` is present.
- `src/daemon/index.ts:88-96` translates `onStart` into `store.setDefault(profileOverride)`.
- `test/unit/main-entry.test.ts:1-30` only checks the packaged entrypoint boot path, not the override transport.

## Recommendation
Add an IPC-server regression that sends a `start` frame with `profileOverride` and asserts the daemon calls `onStart` with the same identity and responds with an active status frame.

## Resolution
Added an isolated IPC-server regression that sends a `start` frame with `profileOverride: 'work'` and verifies `onStart` receives the override and the daemon store default updates to `work`.

## Self-Review
- Task drift: the proof stayed at the IPC authority boundary and did not change the runtime contract.
- Task residue: none after `pnpm typecheck` and `pnpm exec vitest run test/unit/ipc-server.test.ts` passed.
