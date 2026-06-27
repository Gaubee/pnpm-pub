---
title: recursive current-project filters do not resolve from command cwd
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish does not support native current-project filters such as `--filter .` and graph composition such as `--filter ./...`.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` argument behavior. Native pnpm resolves `.` relative to the command CWD/current project. Without that context, `pnpm-pub publish -r --dry-run --filter .` from a workspace package cannot select the current package, and `./...` cannot expand from the current package as a graph seed.

## Evidence

- Native probe: from a public workspace root, `pnpm publish -r --dry-run --no-git-checks --filter .` packs the root package.
- Native probe: from `packages/a`, `pnpm publish -r --dry-run --no-git-checks --filter .` packs `packages/a`.
- Native probe: from `packages/a`, `pnpm publish -r --dry-run --no-git-checks --filter ./...` packs `packages/a`.
- `src/daemon/scheduler.ts` currently builds recursive filter context from the workspace root and package list only, so selector matching has no source CWD/current-project fact.
- `selectorTextMatches('./', ...)` normalizes to an empty selector and cannot match a package path or package name.

## Recommendation

Carry the original directory source into recursive filter context and resolve it to the owning workspace package. Treat `.` and `./` as current-project selectors during seed matching, preserving existing direct, graph, changed-since, and production-edge behavior.

## Resolution

Fixed by carrying the original directory source into recursive filter context and resolving it to the owning workspace package by longest matching package path. `.` and `./` now match that current package, so direct filters and graph seeds such as `./...` can compose through existing recursive selector laws.

Verification:

- native probe: from workspace root, `pnpm publish -r --dry-run --no-git-checks --filter .`
- native probe: from `packages/a`, `pnpm publish -r --dry-run --no-git-checks --filter .`
- native probe: from `packages/a`, `pnpm publish -r --dry-run --no-git-checks --filter ./...`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
