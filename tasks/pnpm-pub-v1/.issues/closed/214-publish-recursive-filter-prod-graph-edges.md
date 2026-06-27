---
title: recursive publish dry-run treats filter-prod like filter
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish ignores `--filter-prod`, so production-only graph selectors are either not applied or use the same dependency graph as `--filter`.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native `--filter-prod` still supports direct package/path matching, but graph traversal excludes `devDependencies` while keeping `dependencies`, `optionalDependencies`, and `peerDependencies`. Treating it like `--filter` causes recursive dry-run to pack dev-only dependencies or dev-only dependents that native pnpm omits.

## Evidence

- Native probe: `--filter 'native-filter-prod-app...'` packs peer, dev, optional, prod, and app packages.
- Native probe: `--filter-prod 'native-filter-prod-app...'` packs peer, optional, prod, and app packages, excluding the devDependency package.
- Native probe: `--filter-prod 'native-filter-prod-*'` still directly matches all package names, including the dev package.
- Native probe: `--filter-prod '...native-filter-prod-dev'` packs only the dev package and does not include its dev-only dependent app.
- `src/daemon/scheduler.ts` currently reads only `--filter`, and workspace package facts currently merge dependency fields into one `dependencyNames` list.

## Recommendation

Read `--filter-prod` as a recursive filter source and preserve production dependency names separately from all dependency names. Use production edges for graph expansion when the selector came from `--filter-prod`, while keeping direct matching behavior unchanged.

## Resolution

Fixed by splitting workspace package dependency facts into `dependencyNames` and `productionDependencyNames`, then threading each recursive selector's source through graph expansion. `--filter` continues to traverse all dependency fields, while `--filter-prod` traverses only `dependencies`, `optionalDependencies`, and `peerDependencies`; direct matching remains unchanged.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `git diff --check`
