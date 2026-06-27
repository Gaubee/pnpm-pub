---
title: Publish config namespace options are rejected instead of warning like native pnpm
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish` rejects native-accepted `--config.*` arguments during publish option validation.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` argument behavior. Native pnpm accepts `--config.foo=bar` and `--config.foo bar` as warning-bearing npm config inputs, while keeping `bar` as a positional publish source in the space-separated form. Rejecting this namespace creates a compatibility break at the CLI intent boundary.

## Evidence

- Native probe: `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo=bar` exits `0` and prints `npm warn Unknown cli config "--config.foo"`.
- Native probe: `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo bar` exits `0`, prints the same warning, and publishes from `bar` when it contains a package.
- `src/daemon/scheduler.ts` currently validates all unrecognized `--*` arguments as unknown publish options before source resolution.

## Resolution

Treated `--config.*` as native's warning-bearing config namespace rather than as an unknown publish option. `--config.foo=bar` now reaches dry-run execution and emits the native warning on stderr, while `--config.foo bar` preserves `bar` as the publish source.

Verification:

- native `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo=bar` probe
- native `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo bar` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
