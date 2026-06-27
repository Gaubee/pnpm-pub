---
title: recursive publish dry-run no-match filters fail instead of native no-op
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish treats filters that match no workspace packages as a failed event, writes the message to stderr, and exits with code 1.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native `pnpm publish -r --dry-run --filter <missing>` exits successfully and writes `No projects matched the filters in "<root>"` to stdout. The daemon currently turns the same no-op selector projection into a failure, which can break shell workflows that rely on native pnpm no-match behavior.

## Evidence

- A native temporary workspace probe showed graph and missing selector cases returning exit 0 with stdout `No projects matched the filters in "<root>"`.
- `src/daemon/scheduler.ts` currently handles `selected.length === 0` by resolving the event as `failed`, writing `No workspace packages matched recursive publish filters.` to stderr, and exiting with code 1.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 203 keeps recursive publish parity residuals active.

## Recommendation

Treat recursive dry-run no-match filters as a native no-op success: write the native-style stdout message, resolve the event successfully, and perform no packing or registry writes.

## Resolution

Changed recursive dry-run no-match filter handling to resolve successfully, emit `No projects matched the filters in "<root>"` on stdout, exit 0, and skip all packing and registry writes.

Verification:

- native temporary `pnpm publish -r --dry-run --no-git-checks --filter <missing>` probe through graph/no-match selector checks
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
