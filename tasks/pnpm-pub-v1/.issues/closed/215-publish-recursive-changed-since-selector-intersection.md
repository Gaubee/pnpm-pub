---
title: recursive changed-since filters cannot intersect package or directory selectors
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish only recognizes changed-since selectors when the entire selector is `[ref]`. Native pnpm also supports intersecting changed files with package or directory selectors, such as `pkg[HEAD]` and `{packages/a}[HEAD]`.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` argument behavior. Without changed-since selector intersections, recursive dry-run cannot express "changed packages within this package identity or path scope", so it either selects nothing or requires broader filters than native pnpm.

## Evidence

- Native probe: `pnpm publish -r --dry-run --no-git-checks --filter 'pkg-a[HEAD]'` selects changed `pkg-a` and does not select unchanged `pkg-b`.
- Native probe: `pnpm publish -r --dry-run --no-git-checks --filter '{packages/a}[HEAD]'` selects changed package `packages/a`.
- `src/daemon/scheduler.ts:520` parses `{...}` only when the selector ends with `}`.
- `src/daemon/scheduler.ts:531` parses changed-since only when the full selector starts with `[` and ends with `]`.
- `src/daemon/scheduler.ts:613` therefore cannot model package/path selector intersection with changed-since source facts.

## Recommendation

Extend recursive selector parsing so a trailing `[ref]` suffix becomes an additional selector constraint. Preserve existing `[ref]`, `{dir}`, `pkg{dir}`, and graph selector behavior, but require changed-since suffix intersections to match both the identity/path constraint and the changed package fact.

## Resolution

Fixed by parsing trailing `[ref]` as a changed-since constraint on top of the existing package and directory selector parts. `[HEAD]` still selects changed packages directly, while `pkg[HEAD]`, `{dir}[HEAD]`, and composed graph seeds now require both the selector scope and the changed package fact.

Verification:

- native probe: `pnpm publish -r --dry-run --no-git-checks --filter 'pkg-a[HEAD]'`
- native probe: `pnpm publish -r --dry-run --no-git-checks --filter '{packages/a}[HEAD]'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
