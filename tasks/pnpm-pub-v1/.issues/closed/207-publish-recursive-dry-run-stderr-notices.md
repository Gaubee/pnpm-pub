---
title: recursive publish dry-run omits npm notice stderr
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish packs workspace packages and emits native-style stdout success lines, but it does not emit the native `npm notice` tarball facts on stderr.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive dry-run writes package contents, tarball details, integrity, and a dry-run publishing line to stderr. Omitting that stream makes the daemon projection less useful for users comparing the intercepted command with native pnpm output.

## Evidence

- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks` stdout as `+ native-notice-a@1.0.0` and `+ native-notice-b@2.0.0`.
- The same probe showed stderr blocks beginning with `npm notice`, followed by package contents, tarball details, and `Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)` for every package.
- `src/daemon/scheduler.ts` currently emits only stdout success lines inside `runRecursivePublishDryRun`.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 202 records missing recursive dry-run stderr notice parity as a residual.

## Recommendation

Format recursive dry-run stderr notices from the packed tarball summary and command/package publish configuration, without performing registry writes or turning notice text into source truth.

## Resolution

Added a recursive dry-run notice formatter that derives `npm notice` stderr text from packed tarball facts, package publish configuration, and CLI arguments. Recursive dry-run still emits native-style `+ name@version` lines on stdout and never calls `publishPackage`.

Verification:

- native temporary `pnpm publish -r --dry-run --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
