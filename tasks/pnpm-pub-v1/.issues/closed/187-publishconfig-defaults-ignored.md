---
title: Publish ignored package publishConfig defaults
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 183
resolution: fixed
---

## Summary

Confirmed publish events preserve raw `pnpm publish` args, but the daemon does not preserve package-level `publishConfig` defaults from `package.json`.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and `spec/07.md` defines the CLI as a thin publish proxy. Native publish behavior treats package metadata as publish input, so ignoring `publishConfig.registry`, `publishConfig.tag`, or `publishConfig.access` can write to the wrong registry, tag, or access mode when the user did not repeat those values on the command line.

## Evidence

- `src/daemon/scheduler.ts` parses package metadata only for `name`, `version`, and `description`.
- `src/daemon/scheduler.ts` resolves publish registry/tag/access only from raw CLI args and the profile registry fallback.
- `pnpm help publish` documents `--tag` and `--access` as publish options; package `publishConfig` is the package source that supplies these publish defaults when the command omits them.

## Resolution

- Added a daemon package `publishConfig` decoder for `registry`, `tag`, and `access`.
- Preserved package publish defaults in CLI-intercepted and workspace-scanned publish targets.
- Resolved confirmed publish writes with precedence `CLI args > package publishConfig > profile/default registry`.
- Added regressions for package defaults, CLI override precedence, workspace scanning, WebUI protocol type parity, and WebSocket decoding.
