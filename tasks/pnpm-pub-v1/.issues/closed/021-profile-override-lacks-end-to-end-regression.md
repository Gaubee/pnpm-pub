---
title: "Profile override lacks end-to-end regression"
state: closed
github_issue_status: closed
label: "identity"
---

## Summary
`src/cli/cli.ts`, `src/daemon/ipc-server.ts`, and `src/daemon/scheduler.ts` already implement explicit `--profile` override handling, but the task ledger has no direct regression proving the override survives the CLI transport and becomes the event identity at confirm time.

## Impact
The profile-override law is a source-of-action boundary. Without a focused regression, a later refactor could silently fall back to the default profile or drop the override on the wire, breaking the isolation rule the spec requires.

## Evidence
- `src/cli/cli.ts:95-120` sends `profileOverride` on publish intents.
- `src/daemon/ipc-server.ts:160-171` applies `start --profile` through `onStart`.
- `src/daemon/scheduler.ts:175-196` resolves and stores `profileOverride` on pending publish events.
- `test/unit/cli-handshake.test.ts:1-110` covers daemon-version retry, but not the override payload path.

## Recommendation
Add focused regressions for `pnpm-pub --profile ... publish` and the scheduler pending-event identity so the override path is pinned end to end.

## Resolution
Added a CLI publish regression proving `--profile=work` survives transport into the publish frame, and a scheduler regression proving the pending event stores `profileOverride` for confirm-time identity selection.

## Self-Review
- Task drift: the fix stayed inside the identity override boundary and did not add any fallback or dual-path behavior.
- Task residue: none after `pnpm typecheck` and the focused CLI/scheduler vitest run passed.
