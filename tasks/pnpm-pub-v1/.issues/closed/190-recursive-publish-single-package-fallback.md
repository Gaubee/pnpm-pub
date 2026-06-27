---
title: Recursive publish falls back to a single package write
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 186
resolution: fixed
---

## Summary

Native `pnpm publish -r` / `pnpm publish --recursive` publishes multiple workspace packages, but the daemon currently treats those args as an ordinary single publish.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and `spec/07.md` defines the CLI as a thin publish proxy. If a user runs `pnpm-pub publish --recursive`, the current daemon can publish only the caller's resolved source package after GUI confirmation. That is worse than an unsupported feature error because it creates a registry-visible effect from the wrong publish ontology.

## Evidence

- `src/daemon/scheduler.ts` resolves every publish intent into one `PublishSource`.
- `src/daemon/scheduler.ts` then calls `runPublish()` for a single `PubEvent`.
- `pnpm help publish` documents `-r, --recursive` for publishing all matching workspace packages.
- Milestone 185 still records broader recursive/workspace publish parity as incomplete.

## Resolution

- Added scheduler-side detection for `-r`, `--recursive`, `--recursive=<value>`, and `--no-recursive`.
- Confirmed recursive publish events now fail before credential access, packing, tarball reading, or registry writes.
- Added a regression proving `pnpm-pub publish --recursive --filter ./packages/*` does not degrade into a single-package publish.
- Left full multi-package recursive publish as a separate platform atom rather than adding a mesh of single-package special cases.
