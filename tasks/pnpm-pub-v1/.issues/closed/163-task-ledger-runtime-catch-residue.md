---
title: Older runtime catch residues stayed current after later closures
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Older runtime error-projection milestones and issue self-reviews still described daemon, WebServer, scheduler, CLI, and avatar catch/decoding residues as current after later rounds had already replaced the unchecked `Error` assertions and response casts with unknown-safe projection helpers.

## Impact

The stale ledger text could pull future LOOP rounds back into already-closed type-safety work. Runtime failures are external source input until decoded, so the task ledger should conserve to the current `unknown -> projection helper` law rather than historical residue text.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md:1948` now points the broader runtime catch residue at issues 111, 112, 114, and 115.
- `tasks/pnpm-pub-v1/TASKS.md:1969` now points the WebServer follow-up residue at issues 112, 114, and 115.
- `tasks/pnpm-pub-v1/TASKS.md:1990` now points the scheduler follow-up residue at issues 114 and 115.
- `tasks/pnpm-pub-v1/TASKS.md:1991` now points the avatar response-decoding residue at issue 113.
- `tasks/pnpm-pub-v1/TASKS.md:2033` now points the CLI top-level catch residue at issue 115.
- `src/daemon/index.ts:105` logs unhandled rejections through `errorToLogMessage`.
- `src/daemon/scheduler.ts:192` projects scheduler write failures through `errorToMessage`.
- `src/daemon/web-server.ts:414` projects WebServer persistence failures through `errorToMessage`.
- `src/cli/cli.ts:400` writes top-level CLI fatal failures through `formatCliFatalError`.

## Resolution

Corrected the ledger projection without changing runtime code:

```text
old runtime catch residue
    |
    v
issues 111 / 112 / 113 / 114 / 115
    |
    v
current task ledger
```

The current source law remains: catch boundaries accept `unknown` and project through local helpers before writing logs, HTTP responses, Event results, or terminal output.

## Self-Review

Task offset: this round stayed in task-ledger projection cleanup and did not change daemon lifecycle, scheduler execution, WebServer persistence, avatar fetching, or CLI routing behavior.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
