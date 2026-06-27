---
title: recursive publish dry-run ignores negated filters
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish supports positive path and package-name filters, but negated filters such as `--filter '!pkg-name'` are not interpreted as exclusions.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive publish uses negated filters to subtract packages from either the full workspace set or a positive filtered set. Ignoring negation can pack packages that native pnpm would skip.

## Evidence

- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks --filter '!native-neg-b'` packed `native-neg-a` and `other-c`, excluding `native-neg-b`.
- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks --filter 'native-neg-*' --filter '!native-neg-b'` packed only `native-neg-a`.
- `src/daemon/scheduler.ts` currently treats all recursive filters as positive matches through `recursiveFilterMatches`.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 201 records incomplete recursive selector parity as a residual.

## Resolution

Split recursive filters into positive and negated sets: start from all packages when only negated filters are present, otherwise start from positive matches, then subtract packages matching any negated filter.

Verification:

- native temporary `pnpm publish -r --dry-run --no-git-checks --filter '!native-neg-b'` probe
- native temporary `pnpm publish -r --dry-run --no-git-checks --filter 'native-neg-*' --filter '!native-neg-b'` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
