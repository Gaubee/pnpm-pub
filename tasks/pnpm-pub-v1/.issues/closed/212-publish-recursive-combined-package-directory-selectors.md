---
title: recursive publish dry-run ignores combined package directory selectors
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats combined selectors such as `pkg{packages/*}` as one literal filter instead of intersecting package-name matching with directory matching.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive publish supports combined package-plus-directory selectors and composes them with graph selectors. Missing that intersection law turns valid native commands into no-match projections or selects the wrong package set.

## Evidence

- Native probe: `pnpm publish -r --dry-run --filter 'native-combo-a{packages/*}' --no-git-checks` packs only `native-combo-a` under `packages/*`.
- Native probe: `pnpm publish -r --dry-run --filter 'native-combo-*{packages/a}' --no-git-checks` packs only the package in `packages/a`.
- Native probe: `pnpm publish -r --dry-run --filter 'native-combo-a{packages/a}...' --no-git-checks` expands the intersected seed through dependency graph closure.
- `src/daemon/scheduler.ts` currently normalizes only selectors entirely wrapped in `{...}`; `pkg{packages/*}` remains a single literal selector.

## Recommendation

Parse recursive selectors with a trailing `{directory}` component as an intersection of package selector and directory selector. Reuse the existing exact/glob/path matching laws and preserve graph selector composition.

## Resolution

Added a typed recursive selector parser that splits trailing `{directory}` components from optional package selectors. Full-brace directory selectors still match by directory only, while combined selectors now require both package identity and directory scope to match. Graph selector composition is preserved because dependency and dependent expansion still use the same seed matcher.

Verification:

- native `pnpm publish -r --dry-run --filter 'native-combo-a{packages/*}' --no-git-checks` probe
- native `pnpm publish -r --dry-run --filter 'native-combo-*{packages/a}' --no-git-checks` probe
- native `pnpm publish -r --dry-run --filter 'native-combo-a{packages/a}...' --no-git-checks` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
