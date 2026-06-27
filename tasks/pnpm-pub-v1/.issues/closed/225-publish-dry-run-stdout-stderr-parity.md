---
title: Publish dry-run emits daemon progress instead of native stdout and stderr
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Single-package `pnpm-pub publish --dry-run` still emits daemon-owned progress text to stdout instead of native `pnpm publish --dry-run` output.

## Impact

`spec/01.md` and `spec/07.md` require publish arguments and terminal behavior to remain compatible with native `pnpm publish`. Current stdout is a local projection (`packing`, `packed`, `Dry run complete`) rather than the package-manager contract, which breaks scripts that expect the native `+ name@version` success line and npm notice details on stderr.

## Evidence

- Native probe: `pnpm publish --dry-run --no-git-checks` prints `+ single-dry-run-pkg@1.2.3` to stdout and npm notice tarball details to stderr.
- Native probe: `pnpm publish --dry-run --report-summary --no-git-checks` exits successfully without writing `pnpm-publish-summary.json`.
- Current `src/daemon/scheduler.ts` single-package dry-run path logs `packing ...`, `packed ... bytes`, and `Dry run complete; no registry write performed.` to stdout.
- Current `test/unit/proactive-events.test.ts` asserts that daemon summary stdout for non-json dry-run.

## Resolution

For non-json single-package dry-run, `src/daemon/scheduler.ts` now reuses the tarball notice projection, writes npm notices to stderr, writes only `+ name@version` to stdout, keeps registry writes blocked, and preserves the native no-summary behavior for `--report-summary`.

Verification:

- native `pnpm publish --dry-run --no-git-checks` stdout/stderr probe
- native `pnpm publish --dry-run --report-summary --no-git-checks` no-summary probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
