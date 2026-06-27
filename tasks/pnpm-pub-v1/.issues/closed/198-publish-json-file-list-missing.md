---
title: publish --json omitted tarball file-list fields
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish --json` emitted a parseable package JSON projection, but it omitted tarball inspection fields that native `pnpm publish --json` includes, such as `unpackedSize`, `files`, `entryCount`, and `bundled`.

## Impact

`spec/01.md` and `spec/07.md` require native `pnpm publish` compatibility. JSON stdout is a machine-facing projection; omitting file-list facts weakened downstream tooling that inspects publish contents without unpacking the tarball itself.

## Evidence

- A local native `pnpm publish --dry-run --json --no-git-checks` probe prints `unpackedSize`, `files`, `entryCount`, and `bundled`.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 190 recorded the minimal JSON package projection as a residual.
- `src/daemon/scheduler.ts` now formats JSON from name/version, tarball digest facts, and the typed tarball summary returned by `summarizePackageTarball`.
- `src/daemon/packer.ts` now parses npm tar entries into normalized package file facts.

## Resolution

Added a typed tarball summary projection in `src/daemon/packer.ts` and included `unpackedSize`, `files`, `entryCount`, and `bundled` in scheduler `--json` output when the publish source is a valid npm tarball. Added focused regressions for real tarball summarization and scheduler JSON emission.
