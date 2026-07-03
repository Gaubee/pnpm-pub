---
title: "CLI and daemon handshake versions were hardcoded instead of package.json-sourced"
state: closed
github_issue_status: closed
label: "architecture"
---

## Summary

Chapter 7 requires the CLI handshake to carry the CLI version read from `package.json`, but the CLI and packaged daemon entry each duplicated `0.1.0` as runtime constants.

## Impact

The version handshake is the release self-replacement law: a newer CLI must make an older daemon self-destruct so a fresh daemon can start. Hardcoded versions let release truth drift away from `package.json`, weakening that law and creating a hidden compatibility branch in practice.

## Evidence

- `src/shared/package-version.ts` now resolves the nearest `pnpm-pub` `package.json` and reads its `version`.
- `src/cli/cli.ts` now uses `readPackageVersion()` for `cliVersion` handshakes.
- `src/daemon/main.ts` now passes `readPackageVersion()` into `bootDaemon()`.
- `test/unit/cli-handshake.test.ts` proves the CLI emits the package version in the handshake.
- `test/unit/main-entry.test.ts` proves the packaged daemon boots with the package manifest version, sourced through the shared reader.

## Resolution

- Added a shared package-version reader as the release-truth boundary.
- Removed the duplicated runtime `0.1.0` constants from the CLI and daemon entry.
- Kept the dev runner's explicit `0.1.0-dev` identity untouched because it is a named dev-mode runtime, not release package truth.

## Self-Review

- Task offset: this round changed the release/version source boundary and did not alter the IPC frame schema.
- Task residue: the test-fixture version literal residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/171-package-version-test-fixture-literal.md`.
