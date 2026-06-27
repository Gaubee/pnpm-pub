---
title: Recursive dry-run publish does not support combined dependency/dependent graph selectors
state: resolved
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish supports dependency graph selectors (`pkg...`) and dependent graph selectors (`...pkg`) independently, but not pnpm's combined selector form (`...pkg...`).

## Impact

Users who expect native pnpm recursive dry-run parity cannot preview the full impact surface around a workspace package. The current selector law can model dependencies or dependents, but not both around the same source atom.

## Evidence

- Before the fix, `expandRecursiveFilter()` handled dependency graph selectors and dependent graph selectors as separate prefix/suffix branches, but did not compose both directions for one seed.
- Native probe after `pnpm install --ignore-scripts` in a temporary workspace showed `pnpm publish -r --dry-run --filter '...native-both-mid...' --no-git-checks` emits:
  - `+ native-both-leaf@1.0.0`
  - `+ native-both-mid@1.0.0`
  - `+ native-both-app@1.0.0`

## Resolution

Added a first-class combined graph selector expansion at `src/daemon/scheduler.ts:768` that resolves dependencies before the seed and dependents after the seed, preserving the existing no-registry-write recursive dry-run law.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
