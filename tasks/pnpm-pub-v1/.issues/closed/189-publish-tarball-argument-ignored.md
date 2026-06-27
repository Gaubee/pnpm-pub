---
title: Publish ignored tarball positional argument
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 185
resolution: fixed
---

## Summary

Native `pnpm publish` accepts a positional `[<tarball>|<dir>]`, but tarball positionals are still treated as if no source was provided.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and `spec/07.md` defines the CLI as a thin publish proxy. If a user runs `pnpm-pub publish ./pkg-1.0.0.tgz`, the daemon currently falls back to the caller's current directory source, so the GUI confirmation and registry write can target the wrong package.

## Evidence

- `src/daemon/scheduler.ts` resolves directory positional arguments only when `fs.stat(candidate).isDirectory()` is true.
- `src/daemon/scheduler.ts` then reads target facts from a directory `package.json` and later calls `packPackage(cwd)`.
- `src/daemon/packer.ts` has a directory packer but no tarball metadata reader.
- `pnpm help publish` documents `Usage: pnpm publish [<tarball>|<dir>] [--tag <tag>] [--access <public|restricted>] [options]`.

## Resolution

- Replaced the pending publish event's implicit directory source with an explicit `PublishSource` discriminated union.
- Added a tarball reader that gunzips an npm `.tgz`, extracts embedded `package.json` metadata, and preserves the original tarball bytes for publishing.
- Resolved CLI positional sources to either `{ kind: "directory" }` or `{ kind: "tarball" }` before creating the pending event.
- Updated publish confirmation and dry-run handling so tarball sources are read directly instead of repacking the caller's current directory.
- Added regressions for scheduler tarball routing, real packer tarball metadata extraction, WebUI protocol parity, and WebSocket decoding.
