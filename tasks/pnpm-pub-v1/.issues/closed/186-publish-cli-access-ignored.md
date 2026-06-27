---
title: Publish ignored CLI --access in the registry document
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 182
resolution: fixed
---

## Summary

The CLI preserves raw `pnpm publish` args in `PublishContext.args`, but confirmed publish events did not carry `--access` into the registry publish document.

## Impact

`spec/07.md` explicitly defines `pnpm-pub --access public` as equivalent to `pnpm publish --access public`, and `spec/03.md` shows `args: ["--access", "public"]` as the IPC publish payload. Ignoring `--access` discarded a command-scoped publish fact, especially for scoped packages where public vs restricted access changes the registry-visible result.

## Evidence

- `src/daemon/scheduler.ts` stores raw publish args in the pending event payload.
- `src/daemon/scheduler.ts` already extracted `--registry` and `--tag`, but not `--access`.
- `src/daemon/npm-api.ts` built the publish document without an `access` field.

## Resolution

- Added scheduler-side access resolution for `--access <value>` and `--access=<value>`.
- Passed the resolved access value into `publishPackage()` only when the publish command supplied one.
- Changed `publishPackage()` to include `access` in the registry publish document when supplied.
- Added regressions proving both scheduler forwarding and registry document output.
