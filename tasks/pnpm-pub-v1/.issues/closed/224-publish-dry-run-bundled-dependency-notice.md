---
title: Publish dry-run notice omits bundled dependency projection
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Native `pnpm publish --dry-run` reports bundled dependency facts in the npm notice projection, but `pnpm-pub` currently flattens tarball entries into the normal Tarball Contents section and omits the bundled dependency section.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native publish semantics while forwarding publish args. Bundled dependency notices are projection facts from the tarball source; omitting them makes dry-run output drift from native pnpm without changing the underlying package bytes.

## Evidence

- Native probe with `bundleDependencies: ["left-pad"]` and `node-linker=hoisted` reports `npm notice Bundled Dependencies`, `npm notice left-pad`, `npm notice bundled deps: 1`, `npm notice bundled files: 0`, and `npm notice own files: 11`.
- Current tarball summary records every file in one list at `src/daemon/packer.ts:114`, including files under `node_modules`.
- Current notice formatting only prints Tarball Contents and `total files` at `src/daemon/scheduler.ts:453`.

## Resolution

Derived bundled dependency names from tarball package metadata in `src/daemon/packer.ts`, kept bundled `node_modules` files out of the normal own-file contents projection, and emitted native bundled dependency notice lines from `src/daemon/scheduler.ts`.

Verification:

- `pnpm exec vitest run test/unit/packer.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
