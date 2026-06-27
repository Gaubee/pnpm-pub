---
title: Packer deleted package-local tarballs before publish
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 178
resolution: fixed
---

## Summary

`packPackage()` deleted every `*.tgz` in the package directory before running `pnpm pack` / `npm pack`.

## Impact

The spec requires the publish proxy to stay compatible with native `pnpm publish`; silently deleting package-local tarballs turns user artifacts into daemon scratch state. That violates source conservation and can destroy unrelated files before the user confirms the external publish result.

## Evidence

- `src/daemon/packer.ts` previously removed all entries ending in `.tgz` from `cwd` before packing.
- `spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`.
- `spec/08.md` routes the user-triggered publish action through the pending wall; the daemon should not erase unrelated package files as part of artifact projection.

## Resolution

- `packPackage()` now writes the produced tarball into a daemon-owned temp directory via `--pack-destination`.
- The temp directory is removed after the tarball bytes are read.
- `PackResult` no longer exposes a durable tarball path projection; the publish atom receives only the tarball bytes and package metadata it actually needs.
- Added a regression proving existing package-local `*.tgz` files are preserved and no new tarball is written into the package directory.
