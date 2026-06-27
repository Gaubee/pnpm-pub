---
title: Workspace gitignore parser ignored negation rules
state: closed
github_issue_status: closed
label: workspace
resolution: fixed
---

## Summary

The workspace scanner skipped every `.gitignore` line starting with `!`. A package directory re-included by a later negation rule could stay excluded from the workspace projection even though the `.gitignore` source declared it visible.

## Impact

Chapter 5.3.4 makes `.gitignore` an exclusion law for workspace scanning. If the scanner drops negation rules, the WebUI can lose legitimate package atoms and later publish or OIDC actions cannot conserve back to the user's workspace source.

## Evidence

- `src/daemon/workspace.ts:253` now stores `.gitignore` as ordered exact/name/pattern rules with a `negated` flag.
- `src/daemon/workspace.ts:271` parses `!` entries instead of skipping them.
- `src/daemon/workspace.ts:299` applies matching rules in source order, so later negation rules re-include paths.
- `test/unit/workspace.test.ts:205` proves fallback scanning preserves `packages/keep` after `packages/*` plus `!packages/keep`.
- `test/unit/workspace.test.ts:244` proves `pnpm-workspace.yaml` package globs preserve the same re-included directory.

## Resolution

The gitignore parser now follows a small ordered-rule law:

```text
.gitignore line order
    |
    v
exact/name/pattern rule + negated flag
    |
    v
last matching rule decides workspace visibility
```

This keeps the scanner lightweight while removing the stale special case that treated negation as absent source input.

## Self-Review

Task offset: this round stayed inside root `.gitignore` directory rules for workspace scanning. It did not add a full Git ignore engine, nested `.gitignore` files, escaped pattern syntax, or every anchored pattern edge case.

Task residue: Remaining full Git ignore parity beyond exact/name/wildcard/negation directory rules stays outside this lightweight parser atom. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
