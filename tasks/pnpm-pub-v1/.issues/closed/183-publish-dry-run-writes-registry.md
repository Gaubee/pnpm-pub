---
title: Publish dry-run still wrote to the registry after confirmation
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 179
resolution: fixed
---

## Summary

The CLI preserved `--dry-run` inside `PublishContext.args`, but the scheduler ignored those args after confirmation and still called the registry publish atom.

## Impact

`spec/07.md` explicitly states `pnpm-pub --dry-run --no-git-checks` must behave like `pnpm publish --dry-run --no-git-checks`. A dry-run source action authorizes local inspection only; turning it into a registry write violates source conservation and publish compatibility.

## Evidence

- `src/cli/cli.ts` forwards raw publish args through the IPC request.
- `src/shared/index.ts` models `PublishContext.args` as raw `pnpm publish` compatible args.
- `src/daemon/scheduler.ts` previously called `publishPackage()` after confirmation without checking for `--dry-run`.

## Resolution

- Added scheduler-side dry-run detection for `--dry-run`, `--dry-run=<value>`, and `--no-dry-run`.
- Confirmed dry-run publish events now pack the package and resolve successfully without requiring credentials or calling `publishPackage()`.
- Added a regression proving `--dry-run --no-git-checks` packs locally, exits successfully, and performs no registry write.
