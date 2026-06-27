---
title: recursive changed-since filters ignore changed-files-ignore-pattern
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish parses changed-since selectors such as `[HEAD]`, but it does not apply `--changed-files-ignore-pattern` before mapping changed files to workspace package owners.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` argument behavior. Native pnpm removes ignored changed files before selecting changed packages. Without that option, packages that only changed ignored files can still be packed by `pnpm-pub publish -r --dry-run --filter '[HEAD]'`.

## Evidence

- Native probe: `--filter '[HEAD]'` selects both packages when one changed `packages/a/README.md` and another changed `packages/b/index.js`.
- Native probe: adding `--changed-files-ignore-pattern '**/README.md'` excludes package `a` and still selects package `b`.
- Native probe: adding `--changed-files-ignore-pattern 'packages/a/README.md'` also excludes package `a`.
- `src/daemon/scheduler.ts:290` recognizes `--changed-files-ignore-pattern` as an option with a value, but no code feeds it into `readChangedPackagePaths`.
- `src/daemon/scheduler.ts:575` maps every `git diff --name-only` result to package owners without applying ignore patterns.

## Recommendation

Parse `--changed-files-ignore-pattern` values from publish args and pass them into changed-since package detection. Filter changed file paths before owner mapping, preserving existing `[ref]`, selector intersection, graph, and no-registry-write behavior.

## Resolution

Fixed by parsing `--changed-files-ignore-pattern` values from publish args and carrying them into recursive changed-since package detection. Changed file paths are now filtered by the existing repo-relative selector matcher before ownership mapping, so packages with only ignored file changes are not selected.

Verification:

- native probe: `pnpm publish -r --dry-run --no-git-checks --filter '[HEAD]' --changed-files-ignore-pattern '**/README.md'`
- native probe: `pnpm publish -r --dry-run --no-git-checks --filter '[HEAD]' --changed-files-ignore-pattern 'packages/a/README.md'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
