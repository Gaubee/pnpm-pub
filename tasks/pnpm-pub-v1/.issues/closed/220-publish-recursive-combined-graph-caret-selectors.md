---
title: Recursive dry-run combined graph selectors do not match caret seed variants
state: resolved
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish now supports pnpm's combined graph selector form (`...pkg...`), but caret variants around the seed (`...^pkg...`, `...pkg^...`, `...^pkg^...`) are treated as literal package selectors instead of native pnpm selector algebra.

## Impact

Users can hit a no-match projection for selector forms that native pnpm accepts. This weakens the dry-run preview law for workspace impact checks while real recursive registry writes remain correctly blocked.

## Evidence

- Native probe in a temporary workspace after `pnpm install --ignore-scripts` showed these commands all emit dependency, seed, and dependent package lines:
  - `pnpm publish -r --dry-run --filter '...^native-x-mid...' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '...native-x-mid^...' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '...^native-x-mid^...' --no-git-checks`
- Current combined graph expansion in `src/daemon/scheduler.ts` slices the seed between the leading and trailing ellipses, so the caret remains part of the seed selector.

## Resolution

Normalized caret markers around the seed only inside combined graph selector expansion, preserving existing `...^pkg` and `pkg^...` exclude-self behavior for non-combined selectors.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
