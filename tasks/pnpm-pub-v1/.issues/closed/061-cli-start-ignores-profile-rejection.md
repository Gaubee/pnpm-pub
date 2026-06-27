---
title: "CLI start ignored daemon profile rejection"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary
`pnpm-pub start --profile=<name>` sent the selected profile to the daemon but treated the command as successful immediately after writing the IPC frame. If the daemon rejected an unknown profile with an `exit` frame, the CLI could still print the success projection.

## Impact
Chapter 7.1 defines `start [--profile=*]` as a management command and Chapter 7.2 makes the CLI a thin IPC proxy. Printing success before receiving the daemon verdict blurred projection and ontology: the terminal claimed an active daemon/profile state that did not conserve to the daemon's source-of-action decision.

## Evidence
- `src/cli/cli.ts:249` now sends the `start` management frame when a profile override exists.
- `src/cli/cli.ts:251` now returns through `relayStart()` instead of closing the socket immediately.
- `src/cli/cli.ts:280` prints success only after a daemon `status` frame.
- `src/cli/cli.ts:285` forwards daemon `exit` frame messages and exit codes.
- `test/unit/cli-start.test.ts:61` proves an accepted `start --profile=work` prints success and exits `0`.
- `test/unit/cli-start.test.ts:84` proves a rejected `start --profile=ghost` prints the daemon rejection and exits `1`.

## Resolution
- Added CLI-side start-frame relay handling for profile-scoped `start`.
- Preserved the existing non-profile start fast path.
- Added focused CLI regressions for accepted and rejected daemon verdicts.

## Self-Review
- Task offset: this round only closes the CLI projection leak after daemon-side `start --profile` authority was added.
- Task residue: the start-relay log-frame residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/174-cli-start-relay-log-frames.md`.
