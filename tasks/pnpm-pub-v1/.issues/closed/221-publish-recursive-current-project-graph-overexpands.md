---
title: Recursive dry-run current-project graph selectors over-expand from dot seeds
state: resolved
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats current-project dot graph selectors such as `./...`, `....`, `.^...`, `./^...`, `...^.`, and `...^./` as dependency or dependent graph expansions. Native `pnpm publish -r --dry-run` resolves these accepted dot graph forms to the current package only.

## Impact

The daemon can pack extra workspace packages during dry-run preview when the user is in a package directory and asks for a current-project selector. The no-registry-write wall still holds, but the preview set is wider than native pnpm.

## Evidence

- Native probe from a package with both a workspace dependency and a workspace dependent emitted only `+ native-dot3-app@1.0.0` for:
  - `pnpm publish -r --dry-run --no-git-checks --filter './...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '....'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^.'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^./'`
- A second native probe emitted only the current package for:
  - `pnpm publish -r --dry-run --no-git-checks --filter '.^...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter './^...'`
- Current `expandRecursiveFilter()` handles these forms through generic dependency/dependent graph branches.

## Resolution

Added a current-project graph selector branch before generic graph expansion that resolves accepted dot graph forms to the current package source fact only.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
