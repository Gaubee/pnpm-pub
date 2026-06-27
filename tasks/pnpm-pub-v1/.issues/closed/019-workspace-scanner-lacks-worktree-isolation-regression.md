---
title: "Workspace scanner lacks a worktree isolation regression"
state: closed
github_issue_status: closed
label: "workspace"
---

## Summary
`spec/05.md` requires the scanner to skip Git Worktree isolated directories, but the current workspace tests only prove `node_modules`, `.git`, `.gitignore`, and `private` package handling.

## Impact
The scanner law is present in code, but the worktree exclusion path is not locked by a focused regression. That leaves room for a future refactor to regress worktree admin-tree handling without an obvious test failure.

## Evidence
- `spec/05.md:54-55` explicitly requires skipping Git Worktree isolated directories.
- `src/daemon/workspace.ts:82-95` already excludes `.git`, which is the practical guard the scanner uses.
- `test/unit/workspace.test.ts:90-129` covers the main scanner exclusions, but not the worktree isolation case.

## Recommendation
Add a focused scanner regression that builds a fake worktree admin tree under `.git/worktrees/...` and proves the scanner does not report packages from that isolated path.

## Resolution
Added a focused regression in `test/unit/workspace.test.ts` that seeds a fake `.git/worktrees/...` admin tree and verifies the scanner only returns the real repository package.

## Self-Review
- Task drift: the change stayed at the proof boundary and did not alter scanner behavior.
- Task residue: none after `pnpm exec vitest run test/unit/workspace.test.ts` and `pnpm typecheck` passed.
