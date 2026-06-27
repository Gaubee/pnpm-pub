---
title: Publish dry-run json omits native stderr publish notice
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Single-package `pnpm-pub publish --dry-run --json` keeps stdout parseable, but it omits the native stderr publish-destination notice.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native publish behavior. Native `pnpm publish --dry-run --json` writes the package JSON object to stdout and still writes `npm notice Publishing to ... (dry-run)` to stderr. Dropping the stderr notice loses a source-backed terminal fact while preserving only the JSON projection.

## Evidence

- Native probe: `pnpm publish --dry-run --json --no-git-checks` prints a JSON package summary to stdout.
- The same native probe prints `npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)` to stderr.
- Current `src/daemon/scheduler.ts` JSON dry-run branch writes only stdout JSON and does not emit the publish-destination stderr notice.
- Current `test/unit/proactive-events.test.ts` only asserts parseable stdout for this path.

## Resolution

For single-package dry-run with `--json`, `src/daemon/scheduler.ts` now keeps stdout as pure JSON and emits only the native publish-destination notice to stderr, using the same registry, tag, and access resolution law as the non-json dry-run path.

Verification:

- native `pnpm publish --dry-run --json --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
