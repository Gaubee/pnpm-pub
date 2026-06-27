---
title: Recursive dry-run filter-prod unsupported selector descriptor omits production flag
state: resolved
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish now fails unsupported bare graph selectors, but the error descriptor always reports `followProdDepsOnly:false`. Native pnpm reports `followProdDepsOnly:true` when the same unsupported selector is supplied through `--filter-prod`.

## Impact

The command fails before packing, so the safety wall holds. The remaining drift is diagnostic parity: users invoking `--filter-prod` see an error descriptor that does not reflect the selected production-only graph law.

## Evidence

- Native probes in a temporary workspace showed `pnpm publish -r --dry-run --no-git-checks --filter-prod '<selector>'` exits `1` with `followProdDepsOnly:true` for:
  - `...`
  - `^...`
  - `...^`
  - `......`
  - `...^...`
- Current `unsupportedBareGraphSelectorDescriptor()` in `src/daemon/scheduler.ts` hard-codes `followProdDepsOnly:false`.

## Resolution

Threaded the recursive filter edge kind into unsupported selector diagnostics so `--filter-prod` failures preserve the native production-only source fact.

Verification:

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
