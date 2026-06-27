---
title: publish --json emitted non-JSON stdout
state: closed
github_issue_status: closed
label: bug
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm publish --json` changes the publish command's stdout into a machine-readable package summary, but the daemon publish path still wrote human progress and completion lines to stdout.

## Impact

Chapter 7 requires `pnpm-pub <anything-else>` to preserve `pnpm publish` muscle-memory compatibility. A `--json` command source authorizes a JSON projection; mixing daemon progress text into stdout makes downstream tooling unable to parse the publish result.

## Evidence

- `pnpm publish --help` exposes `--json`.
- A local `pnpm publish --dry-run --json --no-git-checks` probe prints a JSON package summary on stdout.
- `src/daemon/scheduler.ts` previously logged `packing ...`, `packed ... bytes`, and `Dry run complete; no registry write performed.` to stdout for dry-runs regardless of `--json`.

## Resolution

- Added scheduler-side `--json` detection as an output projection flag.
- Real publish success and dry-run success now emit one parseable package JSON summary on stdout when `--json` is present.
- Human progress and success text remain unchanged for non-JSON publish commands.
- `test/unit/proactive-events.test.ts` verifies JSON stdout for both real publish success and dry-run, while preserving the existing pack/no-write laws.

Task offset: this round only corrects single-package publish output projection. It does not implement recursive/workspace publish, JSON output for unsupported recursive publish failures, or full pnpm tarball file-list parity.
