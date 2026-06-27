---
title: Publish ignore-scripts flag is ignored during packing
state: resolved
github_issue_status: closed
label: publish-parity
milestone: 189
resolution: fixed
---

## Summary

Native `pnpm publish --ignore-scripts` ignores publish-related lifecycle scripts, but the daemon currently packs directory sources without forwarding that CLI source fact to the pack step.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and the installed `pnpm publish --help` documents `--ignore-scripts`. Ignoring it can run package-owned lifecycle scripts even though the caller explicitly disabled them, creating local filesystem effects from the wrong source of action before the registry write.

## Evidence

- `pnpm publish --help` documents `--ignore-scripts` as ignoring publish-related lifecycle scripts.
- `src/daemon/scheduler.ts` resolved publish registry, tag, access, OTP, and report-summary args, but had no ignore-scripts resolver.
- `src/daemon/packer.ts` ran `pnpm pack --pack-destination <dir>` or `npm pack --pack-destination <dir>` without suppressing lifecycle scripts.

## Resolution

- Added scheduler-side detection for `--ignore-scripts`, `--no-ignore-scripts`, and `--ignore-scripts=<value>`.
- Threaded the flag into directory-source packing for real publish and dry-run flows while leaving existing tarball sources unchanged.
- Updated `packPackage()` so normal packing still prefers `pnpm pack`, while ignore-scripts packing uses `npm pack --ignore-scripts` because `pnpm pack` does not expose that CLI option.
- Added scheduler regressions proving real publish and dry-run forward the flag to the packer.
- Added a real packer regression proving a package `prepack` script does not run when `ignoreScripts` is true.
