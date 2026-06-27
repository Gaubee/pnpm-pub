---
title: Recursive dry-run unsupported bare graph selectors resolve as no-match
state: resolved
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats unsupported bare graph selectors such as `...`, `^...`, `...^`, `......`, and `...^...` as ordinary no-match selectors. Native pnpm fails these selectors with exit code `1` and an unsupported package selector message.

## Impact

Invalid selector input is projected as a successful no-op instead of a failed command. That weakens `pnpm publish` compatibility and hides user input errors, although no registry write occurs.

## Evidence

- Native probes in a temporary workspace showed `pnpm publish -r --dry-run --no-git-checks --filter '<selector>'` exits `1` for:
  - `...`
  - `^...`
  - `...^`
  - `......`
  - `...^...`
- Current `expandRecursiveFilter()` routes these strings through generic graph branches, where empty or malformed seeds simply match no packages.

## Resolution

Added a recursive selector validation branch for unsupported bare graph selectors that fails the event before package packing, tarball reading, or registry calls.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
