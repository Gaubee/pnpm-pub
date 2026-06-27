---
title: Publish unknown options can be reinterpreted as positional sources
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish` can reinterpret the value after an unknown option as a package source instead of failing like native `pnpm publish`.

## Impact

`spec/01.md` and `spec/07.md` require publish argument compatibility with native `pnpm publish`. Native `pnpm publish --dry-run -t beta` fails with `Unknown option: 't'` before packing. The current `findPublishPositionalArg()` skips unknown dash-prefixed tokens, then can treat the following value as a tarball or directory source. That risks creating a visible package effect from an argument shape that native pnpm rejects.

## Evidence

- Native probe: `pnpm publish --dry-run --no-git-checks -t beta` exits `1` with `Unknown option: 't'`.
- `src/daemon/scheduler.ts` only treats a fixed value-option set as consuming the next token; unknown dash-prefixed options are skipped, leaving their following token eligible as a positional source.
- Existing tests cover recognized `--tag`, `--access`, and `--otp` value forms, but not unknown option rejection.

## Resolution

Added an intercept-time publish argument validation boundary in `src/daemon/scheduler.ts`. Unknown publish options now fail with a native-style input error before workspace auto-collection, source resolution, Git checks, packing, tarball reading, credential lookup, or registry writes.

Verification:

- native `pnpm publish --dry-run --no-git-checks -t beta` unknown-option probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
