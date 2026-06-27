---
title: Workspace scanner ignores only exact .gitignore directory entries
state: closed
github_issue_status: closed
label: workspace
resolution: fixed
---

## Summary

Chapter 5.3.4 requires workspace scans to skip directories contained in `.gitignore`. The scanner honored simple exact entries such as `build`, but wildcard directory patterns such as `packages/*/generated/` were treated as literal paths and still allowed generated packages into workspace facts.

## Impact

Generated or ignored package directories could become visible package atoms in the WebUI workspace projection. That makes `.gitignore` less authoritative as a source filter and can pollute proactive actions with packages the project has explicitly excluded.

## Evidence

- `src/daemon/workspace.ts:248` now models `.gitignore` as exact paths plus wildcard directory patterns.
- `src/daemon/workspace.ts:279` converts simple `*` / `**` ignored directory patterns into anchored matchers.
- `src/daemon/workspace.ts:289` applies those rules before recursive descent and package promotion.
- `src/daemon/workspace.ts:334` and `src/daemon/workspace.ts:354` apply the same rule before pnpm-workspace package promotion.
- `test/unit/workspace.test.ts:183` verifies fallback scans skip `packages/*/generated/`.
- `test/unit/workspace.test.ts:194` verifies pnpm-workspace glob scans skip `packages/*/generated/`.

## Resolution

The workspace scanner now treats `.gitignore` as a filter law over candidate scan paths:

```text
.gitignore source rule
    |
    v
exact path or wildcard directory matcher
    |
    v
scanner candidate exclusion
```

Ignored wildcard directories no longer become package facts in either fallback recursive scans or pnpm-workspace-driven scans.

## Self-Review

Task offset: this round stayed inside the workspace scanner atom and did not expand into full Git ignore semantics, negation support, or a dependency on a Git ignore parser.

Task residue: plain name-entry depth support was later added by `tasks/pnpm-pub-v1/.issues/closed/172-workspace-gitignore-name-entry-depth.md`, and ordered negation handling was later added by `tasks/pnpm-pub-v1/.issues/closed/176-workspace-gitignore-negation.md`. Remaining full Git ignore parity beyond exact/name/wildcard/negation directory rules stays outside this parser atom. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
