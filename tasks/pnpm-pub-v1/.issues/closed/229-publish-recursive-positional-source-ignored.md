---
title: Recursive publish positional arguments can replace the workspace source
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish -r` can treat a positional directory or tarball argument as the recursive publish source, while native `pnpm publish -r` ignores positional publish sources and operates from the current workspace.

## Impact

`spec/01.md` and `spec/07.md` require publish argument compatibility with native `pnpm publish`. Recursive publish is a workspace operation: positional package sources belong to single-package publish. Letting a positional token replace the recursive source can pack the wrong package set and create a visible dry-run result from a source of action native pnpm does not honor.

## Evidence

- Native probe: `pnpm publish -r --dry-run --no-git-checks packages/a` still publishes all workspace packages from the current workspace.
- Native probe: `pnpm publish -r --dry-run --no-git-checks other` also publishes the current workspace packages, even when `other/package.json` exists outside the workspace package globs.
- `src/daemon/scheduler.ts` resolves a positional publish source before recursive handling, so a recursive dry-run can derive its root from that positional directory.

## Resolution

For recursive publish intents, source resolution now freezes to the CLI `cwd` and ignores positional package source arguments. Single-package publish keeps positional directory and tarball source resolution.

Verification:

- native `pnpm publish -r --dry-run --no-git-checks packages/a` probe
- native `pnpm publish -r --dry-run --no-git-checks other` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
