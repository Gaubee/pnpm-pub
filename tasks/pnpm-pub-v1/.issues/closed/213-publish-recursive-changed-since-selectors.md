---
title: recursive publish dry-run ignores changed-since selectors
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats changed-since selectors such as `[HEAD]` as literal package-name or path filters instead of selecting workspace packages with changed files since the given git ref.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive publish supports changed-since selectors and composes them with graph selectors such as `...[HEAD]`. Missing that law turns valid native commands into no-match projections or omits dependent packages from recursive dry-run output.

## Evidence

- Native probe: after modifying `packages/a/index.js`, `pnpm publish -r --dry-run --filter '[HEAD]' --no-git-checks` packs only `native-since-a`.
- Native probe: a root-only untracked change with `--filter '[HEAD]'` exits 0 with `No projects matched...`.
- Native probe: after modifying dependency package `packages/b`, `pnpm publish -r --dry-run --filter '...[HEAD]' --no-git-checks` packs `native-since-b` followed by dependent `native-since-a`.
- `src/daemon/scheduler.ts` currently parses package, directory, negation, and graph selectors, but `[HEAD]` remains a literal selector.

## Recommendation

Resolve `[ref]` selectors from `git diff --name-only <ref>` at the recursive workspace root and match packages whose directory contains changed files. Preserve graph selector composition through the existing seed matcher.

## Resolution

Added git-backed changed-since selector resolution for recursive dry-run filters. The scheduler now reads `git diff --name-only <ref>` at the recursive workspace root, maps changed files to owning workspace package directories, and lets `[ref]` participate in the same seed matcher used by direct, negated, combined, and graph selectors.

Verification:

- native `pnpm publish -r --dry-run --filter '[HEAD]' --no-git-checks` probe after a package file change
- native root-only no-match probe for `--filter '[HEAD]'`
- native `pnpm publish -r --dry-run --filter '...[HEAD]' --no-git-checks` probe after a dependency package file change
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
