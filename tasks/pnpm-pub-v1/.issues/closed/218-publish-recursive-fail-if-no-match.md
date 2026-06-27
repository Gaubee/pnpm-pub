---
title: recursive no-match filters ignore fail-if-no-match
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish always exits successfully when filters match no projects, even when `--fail-if-no-match` is present.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` argument behavior. Native pnpm keeps the no-match message but returns exit code `1` when `--fail-if-no-match` is true. Returning success hides a selector mistake that native pnpm would surface to scripts.

## Evidence

- Native probe: `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg` exits `0` and prints `No projects matched the filters in "..."`
- Native probe: adding `--fail-if-no-match` exits `1` with the same message.
- Native probe: `--fail-if-no-match=false` exits `0` with the same message.
- `src/daemon/scheduler.ts` currently resolves no-match recursive dry-run events as success and calls `client.exit(0)` unconditionally.

## Recommendation

Parse `--fail-if-no-match` from publish args and apply it only to recursive no-match results. Preserve the current no-match message and no-registry-write behavior, but resolve the event as failed and exit `1` when the flag is true.

## Resolution

Fixed by parsing `--fail-if-no-match`, `--no-fail-if-no-match`, and `--fail-if-no-match=false` from publish args, then applying the flag only to recursive dry-run no-match results. The no-match message remains unchanged; the event resolves as failed and exits `1` only when the flag is true.

Verification:

- native probe: `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg`
- native probe: `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg --fail-if-no-match`
- native probe: `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg --fail-if-no-match=false`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
