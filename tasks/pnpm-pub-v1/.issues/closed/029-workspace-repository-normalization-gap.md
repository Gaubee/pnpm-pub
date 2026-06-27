---
title: "Workspace repository normalization missed common GitHub URL forms"
state: closed
github_issue_status: closed
label: "workspace"
---

## Summary
`src/daemon/workspace.ts` only normalized a narrow subset of repository strings, so common forms like `git+https://github.com/acme/repo.git` would fail to surface a repository slug in scanned packages.

## Impact
That left the source-backed OIDC path brittle: the UI and daemon were ready to consume repository metadata, but the scanner could still drop it for common package.json repository encodings.

## Evidence
- `src/daemon/workspace.ts:189-214` previously normalized only direct GitHub URL forms.
- `test/unit/workspace.test.ts:118-135` now proves scanned packages preserve repository metadata and normalize `git+https` repository strings to `acme/repo`.

## Resolution
- Broadened repository normalization in the workspace scanner to strip `git+` and accept common GitHub repository URL forms.
- Added regression coverage for the `git+https` package.json encoding.

## Self-Review
- Task offset: the fix stayed in the workspace source pipeline and did not widen into UI projection code.
- Task residue: none after `pnpm exec vitest run test/unit/workspace.test.ts`.
