---
title: publish git checks ignored remote history drift
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

The publish Git safety gate checked dirty worktrees and publish branches, but it did not check whether the local branch was behind or diverged from its configured upstream.

## Impact

Native `pnpm publish` blocks when fetched remote history differs, because a publish from stale local source can create a registry-visible artifact that does not conserve to the latest shared repository source. `pnpm-pub` previously permitted that path after GUI confirmation.

## Evidence

- A local native `pnpm publish --dry-run` probe fails with `ERR_PNPM_GIT_NOT_LATEST` when `origin/main` has fetched commits that local `main` does not contain.
- A local native probe permits a branch that is only ahead of upstream.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 192 recorded pnpm's full upstream "branch is up to date" check as unresolved.
- `src/daemon/publish-git-checks.ts` previously returned success after branch validation without comparing `HEAD` to `@{u}`.

## Resolution

- Extended `src/daemon/publish-git-checks.ts` to compare `HEAD...@{u}` when an upstream exists.
- Publishes now fail when the upstream side has commits not contained in `HEAD`.
- Ahead-only local commits remain publishable, matching the native pnpm probe.
- `--no-git-checks` and `.npmrc git-checks=false` still bypass the Git-check atom before the upstream comparison.
- Added unit coverage for fetched-behind blocking, ahead-only success, and `--no-git-checks` bypass.

Task offset: this round only adds fetched upstream history drift detection. It does not fetch remotes automatically, read global/user npm config, or implement recursive/workspace publish.
