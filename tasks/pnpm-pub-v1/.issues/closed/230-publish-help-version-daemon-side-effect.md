---
title: Publish help and version intents boot the daemon instead of exiting locally
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish --help`, `pnpm-pub publish -h`, and `pnpm-pub publish --version` are terminal-only native publish intents, but the CLI currently routes them through the daemon publish flow.

## Impact

`spec/01.md` and `spec/07.md` require native `pnpm publish` argument compatibility and a thin CLI that preserves terminal behavior. Native `pnpm publish --help`, `-h`, and `--version` exit `0` without packing, profile lookup, GUI confirmation, or registry writes. Routing these intents to the daemon can auto-boot background state, print the GUI waiting line, require configured profiles, and create a false source of action for an informational command.

## Evidence

- Native probe: `pnpm publish --help` exits `0` and prints publish help.
- Native probe: `pnpm publish -h` exits `0` and prints publish help.
- Native probe: `pnpm publish --version` exits `0` and prints the pnpm version.
- `src/cli/cli.ts` disables yargs help/version and sends all fallback publish args through `runPublish()`, which writes `> Waiting for GUI confirmation...` before relaying daemon frames.

## Resolution

Handled native publish help/version intents before IPC. The CLI now delegates `publish --help`, `publish -h`, and `publish --version` to native `pnpm publish`, returns its exit code, and avoids daemon connection or spawn side effects.

Verification:

- native `pnpm publish --help` probe
- native `pnpm publish -h` probe
- native `pnpm publish --version` probe
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
