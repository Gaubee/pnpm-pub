---
title: recursive publish dry-run json emits daemon-owned array
state: closed
github_issue_status: closed
label: publish-parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

Recursive dry-run publish currently treats `--json` as a request for a daemon-owned JSON array projection, but native recursive `pnpm publish --json` still writes simple `+ name@version` success lines to stdout.

## Impact

`spec/01.md`, `spec/02.md`, and `spec/07.md` require `pnpm-pub publish` to preserve native `pnpm publish` command behavior. Returning a JSON array for recursive dry-run makes stdout a projection invented by the daemon rather than the package manager's observed terminal contract.

## Evidence

- A native temporary workspace probe showed `pnpm publish -r --dry-run --json --no-git-checks` stdout as `+ native-json-a@1.0.0` and `+ native-json-b@1.0.0`, with package notices on stderr.
- `src/daemon/scheduler.ts` currently collects recursive dry-run publish projections and writes `JSON.stringify(projections, null, 2)` to stdout when `--json` is present.
- `tasks/pnpm-pub-v1/TASKS.md` Milestone 199 records recursive `--json` as a daemon-owned projection residual.

## Resolution

For recursive dry-run only, replaced the daemon-owned JSON array with native-style `+ name@version` stdout lines while keeping the no-registry-write law unchanged.

Verification:

- native temporary `pnpm publish -r --dry-run --json --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
