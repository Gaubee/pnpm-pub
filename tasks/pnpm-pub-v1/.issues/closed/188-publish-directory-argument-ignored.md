---
title: Publish ignored directory positional argument
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 184
resolution: fixed
---

## Summary

Native `pnpm publish` accepts a positional `[<tarball>|<dir>]`, but the daemon currently reads package metadata and packs from the IPC `cwd` regardless of publish args.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and `spec/07.md` defines the CLI as a thin publish proxy. If a user runs `pnpm-pub publish packages/pkg`, the current daemon can present and publish the caller's current package instead of the requested package directory. That violates source conservation before the physical confirmation wall.

## Evidence

- `src/cli/cli.ts` forwards raw publish args to the daemon.
- `src/daemon/scheduler.ts` calls `readPublishTarget(req.cwd)` during interception.
- `src/daemon/scheduler.ts` stores `payload.data.cwd` as `req.cwd`, and `runPublish()` later calls `packPackage(cwd)`.
- `pnpm help publish` documents `Usage: pnpm publish [<tarball>|<dir>] [--tag <tag>] [--access <public|restricted>] [options]`.

## Resolution

- Added scheduler-side publish source directory resolution from the first non-option positional argument.
- Preserved option-value boundaries so flags such as `--registry <url>` and `--tag <name>` are not mistaken for package directories.
- Used the resolved directory for package metadata, pending event `cwd`, event target path, packing, and publish package identity.
- Added a regression proving `pnpm-pub publish --registry <url> packages/pkg` publishes the requested child package instead of the caller's current package.
- Left tarball positional publishing as an explicit residual because it requires reading metadata from a tarball rather than from a source directory.
