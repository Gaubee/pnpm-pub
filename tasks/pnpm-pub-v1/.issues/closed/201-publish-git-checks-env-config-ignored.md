---
title: publish git-checks ignores npm config environment
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

The publish Git-check atom honored command flags and npm config files, but it did not read npm config environment variables such as `NPM_CONFIG_GIT_CHECKS=false`.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` compatibility. npm config environment values are a command-environment source of package-manager policy; ignoring them could make `pnpm-pub` block or allow publishes differently from native `pnpm publish`.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md` Milestone 196 recorded `NPM_CONFIG_GIT_CHECKS` as the remaining config-source residual.
- `src/daemon/publish-git-checks.ts` now resolves policy from CLI args, npm config environment, project `.npmrc`, user npm config, global npm config, then default.
- `test/unit/publish-git-checks.test.ts` now covers env disabling Git checks, CLI overriding env, and env overriding project `.npmrc`.

## Resolution

Read npm config environment values for `git-checks` after explicit CLI args and before `.npmrc` files, preserving command-line flags as the strongest source of action.
