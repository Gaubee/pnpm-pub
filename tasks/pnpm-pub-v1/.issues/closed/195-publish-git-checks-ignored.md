---
title: publish ignored native git safety checks
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Native `pnpm publish` performs local Git safety checks before packing or publishing, but the daemon publish path currently packed and published without checking whether the package source was on an allowed publish branch or whether the worktree was clean.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` compatibility. Ignoring Git checks could turn a normal `pnpm-pub publish` command into a registry-visible write from a dirty worktree or from an unintended branch, even though the command source did not include `--no-git-checks` or a matching `--publish-branch`.

## Evidence

- `pnpm publish --help` documents `--no-git-checks` and `--publish-branch`.
- A local native pnpm probe fails dirty worktrees with `ERR_PNPM_GIT_UNCLEAN` unless `--no-git-checks` is present.
- A local native pnpm probe on branch `feature` prompts because the default publish branch is `master|main`.
- `src/daemon/scheduler.ts` previously checked recursive/dry-run behavior but had no Git publish gate before packing, credential access, or registry writes.

## Resolution

- Added `src/daemon/publish-git-checks.ts` as a publish Git-check atom independent from the NPM registry boundary.
- The scheduler now runs the Git-check atom before dry-run packing, credential access, or real publish writes.
- `--no-git-checks` skips the gate, and `--publish-branch <name>` / `--publish-branch=<name>` authorizes a non-default branch.
- Dirty worktrees and disallowed branches now fail the Event with no packing or registry write.
- Added direct unit coverage for dirty, bypass, matching branch, and blocked branch behavior.
- Added a scheduler regression proving a dirty publish is blocked before packing or registry calls.

Task offset: this round adds the branch/dirty Git publish gate only. It does not yet implement pnpm's full upstream "branch is up to date" check, package-manager configuration sources such as `.npmrc` `git-checks=false`, or recursive/workspace publish.
