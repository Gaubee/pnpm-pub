---
title: "CLI stop lacks a dedicated regression"
state: closed
github_issue_status: closed
label: "cli"
---

## Summary
`src/cli/cli.ts` has a `pnpm-pub stop` flow, but the current test harness does not directly prove the CLI sends the `stop` IPC frame and exits cleanly when the daemon acknowledges shutdown.

## Impact
The graceful-stop path is part of the management contract. Without a dedicated regression, the stop command could regress independently of publish and status without immediate coverage.

## Evidence
- `src/cli/cli.ts:220-231` implements the stop flow.
- `src/cli/cli.ts:303-324` routes the explicit `stop` subcommand.
- `test/unit/cli-handshake.test.ts:104-175` covers publish and status routing, but not the shutdown acknowledgement path.

## Recommendation
Add a focused CLI stop regression that asserts the command sends `{"command":"stop"}` and prints `Stop signal sent.` when the daemon returns a nonactive status frame.

## Resolution
Added a mocked-net regression that proves `pnpm-pub stop` sends the stop frame and prints the shutdown acknowledgement.

## Self-Review
- Task drift: the fix stayed on the CLI management boundary and did not alter runtime stop behavior.
- Task residue: none after `pnpm typecheck` and `pnpm exec vitest run test/unit/cli-stop.test.ts` passed.
