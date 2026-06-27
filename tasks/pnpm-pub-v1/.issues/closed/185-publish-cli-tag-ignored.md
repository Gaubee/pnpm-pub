---
title: Publish ignored CLI --tag in the registry document
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 181
resolution: fixed
---

## Summary

The CLI preserves raw `pnpm publish` args in `PublishContext.args`, but confirmed publish events always emitted a registry document with `dist-tags.latest`.

## Impact

`spec/07.md` requires `pnpm-pub publish` to preserve native `pnpm publish` argument compatibility. `--tag <name>` is a registry-visible publish fact; ignoring it rewrote the user's command source into a default projection and published the version under `latest` even when the user requested a different dist-tag.

## Evidence

- `src/daemon/scheduler.ts` stores raw publish args in the pending event payload.
- `src/daemon/scheduler.ts` previously passed only registry/token/package facts into `publishPackage()`.
- `src/daemon/npm-api.ts` hardcoded `'dist-tags': { latest: version }` in the publish document.

## Resolution

- Added scheduler-side dist-tag resolution for `--tag <name>` and `--tag=<name>`.
- Passed the resolved dist-tag into `publishPackage()` only when the publish command supplied one.
- Changed `publishPackage()` to emit the chosen dist-tag in the registry publish document, defaulting to `latest` when absent.
- Added regressions proving both scheduler forwarding and registry document output.
