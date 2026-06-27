---
title: recursive publish dry-run ignores brace directory selectors
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats full-brace directory selectors such as `{packages/a}` and `{packages/*}` as literal package-name or path filters instead of matching workspace package directories.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive publish supports brace-wrapped directory selectors, and those selectors compose with dependency graph expansion. Treating braces as literal characters causes valid native commands to become no-match projections or pack the wrong package set.

## Evidence

- Native probe: `pnpm publish -r --dry-run --filter '{packages/a}' --no-git-checks` packs only the package under `packages/a`.
- Native probe: `pnpm publish -r --dry-run --filter '{packages/*}' --no-git-checks` packs packages under `packages/*`.
- Native probe: `pnpm publish -r --dry-run --filter '{packages/a}...' --no-git-checks` expands the selected package through dependency graph closure.
- `src/daemon/scheduler.ts` currently passes selector text directly into `recursiveFilterMatches`, so `{packages/a}` is compared with the relative path `packages/a` without removing the selector braces.

## Recommendation

Normalize full-brace recursive selectors into their inner directory selector before package/path matching, while preserving existing exact-name, glob, negation, and graph selector laws.

## Resolution

Added recursive selector normalization for selectors that are entirely wrapped in `{...}`. The inner directory selector now flows through the existing path/glob matcher, which also preserves graph selector composition because graph expansion already delegates seed matching to the same matcher.

Verification:

- native `pnpm publish -r --dry-run --filter '{packages/a}' --no-git-checks` probe
- native `pnpm publish -r --dry-run --filter '{packages/*}' --no-git-checks` probe
- native `pnpm publish -r --dry-run --filter '{packages/a}...' --no-git-checks` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
