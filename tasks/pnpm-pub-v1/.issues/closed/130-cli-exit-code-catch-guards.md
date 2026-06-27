---
title: CLI tests read caught exit codes through assertions
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`test/unit/cli-start.test.ts` and `test/unit/cli-handshake.test.ts` verified mocked `process.exit()` results by casting caught `unknown` values to `ExitCode`. These tests cover Chapter 7 CLI exit-code pass-through, so the thrown value should be proven before its `code` field is read.

## Impact

The CLI is a thin proxy whose terminal exit code must conserve to the daemon's IPC verdict. Casting caught values weakens that evidence: a non-`ExitCode` throw could still be projected as an exit-code assertion path by the test code.

## Evidence

- `test/unit/cli-start.test.ts:80` now checks the accepted `start --profile` exit through `expectExitCode`.
- `test/unit/cli-start.test.ts:107` now checks the rejected `start --profile` exit through `expectExitCode`.
- `test/unit/cli-start.test.ts:123` defines the local guard that proves `value instanceof ExitCode` before reading `.code`.
- `test/unit/cli-handshake.test.ts:201` now checks the daemon-outdated retry exit through `expectExitCode`.
- `test/unit/cli-handshake.test.ts:217` defines the same local guard for the handshake suite.
- `pnpm exec vitest run test/unit/cli-start.test.ts test/unit/cli-handshake.test.ts` passes.

## Resolution

Replaced caught-value casts with explicit guards:

```text
caught unknown
    |
    v
instanceof ExitCode
    |
    v
exit code assertion
```

## Self-Review

Task offset: this round only strengthens CLI test evidence around mocked `process.exit()` throws; it does not change runtime CLI routing, IPC frames, or daemon exit behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
