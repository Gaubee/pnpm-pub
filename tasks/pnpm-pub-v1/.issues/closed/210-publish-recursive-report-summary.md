---
title: recursive publish dry-run ignores report summary output
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish with `--report-summary` packs selected workspace packages but does not write the native `pnpm-publish-summary.json` artifact at the workspace root.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive dry-run treats the summary file as a local publish projection: selected packages are written to `pnpm-publish-summary.json` even though no registry write occurs. Missing that artifact breaks automation that uses the summary as the source-backed result of a publish command.

## Evidence

- Native probe: `pnpm publish -r --dry-run --report-summary --no-git-checks` writes a workspace-root `pnpm-publish-summary.json`.
- Native probe: the summary contains `publishedPackages` entries for each selected package.
- Native probe: a no-match recursive dry-run with `--report-summary` exits 0 and does not write a summary file.
- `src/daemon/scheduler.ts` currently writes `+ name@version` lines for recursive dry-run packages but does not call a summary writer in `runRecursivePublishDryRun`.

## Recommendation

Write `pnpm-publish-summary.json` at the resolved recursive workspace root when recursive dry-run selects one or more packages and `--report-summary` is present. Keep no-match behavior artifact-free and preserve the no-registry-write law.

## Resolution

Added a typed multi-package publish summary writer and wired recursive dry-run publish to write `pnpm-publish-summary.json` at the resolved workspace root when `--report-summary` is present and at least one package is selected. The no-match path still exits as a native no-op and does not create a summary artifact.

Verification:

- native `pnpm publish -r --dry-run --report-summary --no-git-checks` probe
- native no-match `pnpm publish -r --dry-run --report-summary --filter missing-pkg --no-git-checks` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
