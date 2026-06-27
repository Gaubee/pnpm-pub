---
title: publish git-checks ignores global npm config
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

The publish Git-check atom honored command flags, nearest project `.npmrc`, and user npm config, but it did not read the global npm config source for `git-checks=true|false`.

## Impact

`spec/01.md` and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` compatibility. Global npm config is a lower-priority but durable package-manager policy source; ignoring it left one more gap between `pnpm-pub publish` and native publish behavior.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md` Milestone 195 recorded global npm config sources as the remaining config-source residual.
- `src/daemon/publish-git-checks.ts` now resolves policy as CLI flags, nearest project `.npmrc`, user npm config, global npm config, then built-in default.
- `test/unit/publish-git-checks.test.ts` now covers global config disabling Git checks and user config overriding global config.

## Resolution

Extended the Git-check atom to read the global npm config source after user config and before the built-in default, while preserving CLI, project, and user precedence.
