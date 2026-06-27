---
title: Publish ignored CLI --registry after confirmation
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 180
resolution: fixed
---

## Summary

The CLI preserves raw `pnpm publish` args in `PublishContext.args`, but confirmed publish events resolved their registry only from the active profile.

## Impact

`spec/07.md` requires `pnpm-pub publish` to remain compatible with `pnpm publish` arguments, and `spec/10.md` defines the Verdaccio E2E trigger as `pnpm-pub publish --registry http://localhost:4873`. Ignoring `--registry` turned a command-scoped source fact into a stale profile projection and could publish to the wrong registry after GUI confirmation.

## Evidence

- `src/daemon/scheduler.ts` stores `req.args` in the publish payload during interception.
- `src/daemon/scheduler.ts` previously computed the execution registry from the profile before dispatching write-capable events.
- `src/daemon/scheduler.ts` then called `runPublish(..., registry)` without inspecting `PublishContext.args`.

## Resolution

- Added scheduler-side publish registry resolution from raw CLI args, with profile registry as the default.
- Preserved both `--registry <url>` and `--registry=<url>` forms for publish events.
- Added regressions proving command registry facts override the profile registry before `publishPackage()` is called.
