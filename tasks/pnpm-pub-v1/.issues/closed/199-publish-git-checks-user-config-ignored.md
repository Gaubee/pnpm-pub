---
title: publish git-checks ignores user npm config
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

The publish Git-check atom honored command-source `--git-checks` / `--no-git-checks` and the nearest project `.npmrc`, but it did not read the user npm config source for `git-checks=true|false`.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` compatibility. A user-level npm config is a durable source of publish policy; ignoring it made `pnpm-pub` block or allow publishes differently from the user's configured package-manager law.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md` Milestones 192-194 recorded global/user npm config sources as a residual.
- `src/daemon/publish-git-checks.ts` now resolves policy in this order: CLI flags, nearest project `.npmrc`, user npm config, built-in default.
- `test/unit/publish-git-checks.test.ts` now covers user config disabling Git checks and project `.npmrc` overriding user config.

## Resolution

Extended the Git-check atom to read the user npm config source after project `.npmrc` and before the built-in default, while preserving command-source and project-source precedence.
