---
title: recursive publish dry-run emits daemon progress text
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish still writes daemon progress text such as `packing ...` and `Recursive dry run complete...` to stdout when `--json` is absent.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Native recursive dry-run stdout contains one `+ name@version` success line per package, while package notices are written to stderr. Daemon progress text turns stdout into a local projection rather than the observed package-manager contract.

## Evidence

- A native temporary workspace probe showed `pnpm publish -r --dry-run --no-git-checks` stdout as `+ native-stdout-a@1.0.0` and `+ native-stdout-b@1.0.0`, with package notices on stderr.
- `src/daemon/scheduler.ts` currently logs recursive dry-run package counts, per-package packing messages, packed byte counts, and a final daemon summary to stdout when `--json` is absent.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 200 records non-json recursive notices and progress text as a remaining stdout/stderr parity residual.

## Resolution

For recursive dry-run stdout, emit native-style `+ name@version` lines for every packed package regardless of `--json`, keep event resolution metadata internal, and leave exact npm notice stderr parity as a separate residual.

Verification:

- native temporary `pnpm publish -r --dry-run --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
