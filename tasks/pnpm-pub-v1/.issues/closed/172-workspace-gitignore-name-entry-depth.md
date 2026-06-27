---
title: Workspace scanner treated .gitignore name entries as root-only paths
state: closed
github_issue_status: closed
label: workspace
resolution: fixed
---

## Summary

The workspace scanner parsed a plain `.gitignore` entry such as `generated` as an exact root path only. Git treats a slashless ignore pattern as a name match at any depth, so nested ignored package directories could still become workspace package facts.

## Impact

Chapter 5.3.4 makes `.gitignore` an exclusion law for workspace scanning. If slashless directory names are only root-relative, ignored generated package atoms can enter the WebUI workspace projection and later become publish or OIDC action sources.

## Evidence

- `spec/05.md:54` requires the high-speed scanner to skip directories contained in `.gitignore`.
- `spec/10.md:15` requires workspace scanner tests to include `.gitignore` cases.
- `src/daemon/workspace.ts:251` now keeps slashless ignore entries in a dedicated `names` rule set.
- `src/daemon/workspace.ts:277` now classifies plain non-anchored entries as name rules instead of root-only exact paths.
- `src/daemon/workspace.ts:301` now checks relative path segments against those name rules before package promotion.
- `test/unit/workspace.test.ts:194` proves fallback scans skip nested package directories matching a plain name entry.
- `test/unit/workspace.test.ts:219` proves pnpm-workspace package globs skip package directories matching a plain name entry.

## Resolution

The scanner now models root `.gitignore` entries as three explicit rule atoms:

```text
.gitignore source
    |
    v
exact root path | slashless name | wildcard pattern
    |
    v
candidate path exclusion
```

Plain name entries no longer leak nested ignored directories into scanned package facts. No runtime compatibility branch or external parser dependency was added.

## Self-Review

Task offset: this round stayed inside the workspace scanner atom and tightened one Git ignore rule form required by the spec-backed `.gitignore` exclusion law.

Task residue: ordered negation handling was later added by `tasks/pnpm-pub-v1/.issues/closed/176-workspace-gitignore-negation.md`. Remaining full Git ignore parity beyond exact/name/wildcard/negation directory rules stays outside this lightweight parser atom. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
