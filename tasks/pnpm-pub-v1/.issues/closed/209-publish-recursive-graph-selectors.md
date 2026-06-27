---
title: recursive publish dry-run ignores graph selector expansion
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats graph selectors such as `pkg...`, `pkg^...`, `...pkg`, and `...^pkg` as literal package-name or path filters instead of expanding them through the workspace dependency graph.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive publish uses graph selectors to include workspace dependencies or dependents. Ignoring that selector law causes the daemon to pack the wrong package set or return a no-match projection for valid native commands.

## Evidence

- A native installed workspace probe showed `pkg...` packs workspace dependencies followed by `pkg`.
- The same probe showed `pkg^...` packs workspace dependencies without `pkg`.
- The same probe showed `...pkg` packs `pkg` followed by workspace dependents.
- The same probe showed `...^pkg` packs workspace dependents without `pkg`.
- `src/daemon/scheduler.ts` currently routes every non-negated filter through `recursiveFilterMatches`, which only supports exact names, globs, relative paths, and negation.

## Recommendation

Extend recursive dry-run selector algebra with dependency and dependent graph selectors using package.json dependency fields as source facts, while keeping registry writes blocked.

## Resolution

Added workspace dependency-name source facts and recursive dry-run graph selector expansion for dependency and dependent closures. `pkg...`, `pkg^...`, `...pkg`, and `...^pkg` now select workspace package sets through dependency fields while preserving the no-registry-write law.

Verification:

- native installed workspace `pnpm publish -r --dry-run --no-git-checks --filter <graph-selector>` probes
- native git remote-fetch probe showing pnpm publish dry-run does not fetch remotes
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
