---
title: "CLI status/stop lacks management regression"
state: closed
github_issue_status: closed
label: "cli"
---

## Summary

`src/cli/cli.ts` implements `pnpm-pub status` and `pnpm-pub stop`, but there is no direct regression proving the CLI maps those subcommands to the right IPC frames and prints the expected user-facing output.

## Impact

The thin-client routing law for management commands is a core surface. Without a focused regression, a future CLI refactor could silently break the non-publish commands while leaving publish tests green.

## Evidence

- `src/cli/cli.ts:200-231` contains the status and stop flows.
- `src/cli/cli.ts:303-324` routes the explicit subcommands.
- `test/unit/cli-handshake.test.ts:1-120` covers publish fallback and retry, but not status or stop.

## Recommendation

Add focused CLI regressions that assert `status` prints the active profile and `stop` sends the stop frame and exits cleanly.

## Resolution

Added direct CLI regressions for the management surface:

- `status` prints the active profile.
- `stop` sends the stop frame and prints the shutdown acknowledgement.

## Self-Review

- Task drift: the fix stayed on the thin-client management boundary and did not alter publish semantics.
- Task residue: none after `pnpm typecheck` and the focused CLI tests passed.
