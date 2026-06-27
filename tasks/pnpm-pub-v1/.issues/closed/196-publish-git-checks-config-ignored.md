---
title: publish git checks ignored .npmrc config
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

The publish Git safety gate honored command-source `--no-git-checks`, but it did not read package-manager config sources such as `.npmrc` `git-checks=false`.

## Impact

`spec/01.md` and `spec/07.md` require native `pnpm publish` compatibility. Native pnpm allows projects to disable publish Git checks through `.npmrc`; ignoring that source meant `pnpm-pub publish` could reject a publish that native pnpm accepts, even though the repository has an explicit checked-in policy.

## Evidence

- A local native `pnpm publish --dry-run` probe with `.npmrc` `git-checks=false` allows a dirty worktree.
- A local native `pnpm publish --dry-run` probe with `.npmrc` `git-checks=false` allows a non-default branch.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 191 recorded `.npmrc` `git-checks=false` as an unresolved residual.
- `src/daemon/publish-git-checks.ts` previously only derived the Git-check decision from command args.

## Resolution

- `src/daemon/publish-git-checks.ts` now reads the nearest `.npmrc` source for `git-checks=true|false`.
- CLI flags remain the highest-precedence source, so `--git-checks` can re-enable checks when `.npmrc` disables them.
- Added direct regressions for `.npmrc` dirty-worktree bypass, `.npmrc` non-default-branch bypass, and CLI re-enable precedence.

Task offset: this round only adds `.npmrc` `git-checks` source support. It does not implement pnpm's full upstream "branch is up to date" check, global/user npm config, or recursive/workspace publish.
