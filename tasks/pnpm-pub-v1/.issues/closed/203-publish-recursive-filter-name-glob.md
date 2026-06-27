---
title: recursive publish dry-run ignores package-name glob filters
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish supports simple path filters, but package-name glob filters such as `native-recursive-*` or `@scope/*` do not select packages.

## Impact

`spec/02.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native `pnpm publish -r --dry-run --filter 'name-*'` selects packages by package-name glob, so treating those filters only as paths leaves the recursive dry-run atom below native parity.

## Evidence

- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks --filter 'native-recursive-*'` packed both matching packages.
- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks --filter '@scope/*'` packed the scoped matching package.
- `src/daemon/scheduler.ts` currently matches recursive filters by exact package name or by relative package path glob.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 198 records recursive filter parity as intentionally incomplete.

## Resolution

Extended recursive dry-run filter matching so glob filters are tested against package names as well as relative paths, preserving the existing exact-name and path-filter behavior.

Verification:

- native temporary `pnpm publish -r --dry-run --no-git-checks --filter 'native-recursive-*'` probe
- native temporary `pnpm publish -r --dry-run --no-git-checks --filter '@scope/*'` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
