---
title: "Root Vitest config lacked a matching Vite dependency"
state: closed
github_issue_status: closed
resolution: "Fixed by adding a root vite devDependency pinned to the Vitest-compatible 5.4.x line."
---

## Summary
The root workspace did not declare `vite`, even though the Vitest config imports it.

## Impact
`pnpm typecheck` failed before the real code changes could be verified.

## Evidence
- `package.json:52-64` now declares `vite: ^5.4.21`.
- `vitest.config.ts:1-36` and `vitest.e2e.config.ts:1-29` both import Vite plugin types.
- `pnpm typecheck` now completes successfully.

## Resolution
Added the root Vite devDependency on the same major line that Vitest resolves for its config types.
