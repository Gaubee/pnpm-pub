---
title: Publish report summary flag is ignored
state: resolved
github_issue_status: closed
label: publish-parity
milestone: 188
resolution: fixed
---

## Summary

Native `pnpm publish --report-summary` writes `pnpm-publish-summary.json` with the list of newly published packages, but the daemon currently ignores that flag for single-package publishes.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and the installed `pnpm publish --help` documents `--report-summary` as a publish option. Ignoring it drops a requested filesystem artifact after a registry-visible publish, so downstream tooling cannot trace the publish result through the expected summary source.

## Evidence

- `pnpm publish --help` documents `--report-summary` as saving newly published packages to `pnpm-publish-summary.json`.
- The installed pnpm source writes `{ publishedPackages }` when `opts.reportSummary` is set.
- `src/daemon/scheduler.ts` resolved publish registry, tag, access, and OTP args, but had no report-summary resolver or summary writer.

## Resolution

- Added scheduler-side detection for `--report-summary`, `--no-report-summary`, and `--report-summary=<value>`.
- Wrote `pnpm-publish-summary.json` with `{ publishedPackages: [{ name, version }] }` after a successful real single-package publish.
- Kept dry-run and unsupported recursive publish paths from writing the summary artifact.
- Added regressions proving successful publish writes the artifact and dry-run with the same flag does not.
