---
title: "spec/03.md still implied the Unix socket law was macOS-only"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary
`spec/03.md` described the Unix Domain Socket as a macOS-only rule, while the implementation and shared path law already applied the same socket path to Linux too.

## Impact
The IPC security spec was narrower than the actual code path. That left the law split between the spec and the implementation, which is exactly the kind of drift the task loop should remove.

## Evidence
- `spec/03.md:28` previously said `macOS`.
- `src/shared/paths.ts:52-59` already defined the Unix socket path for `macOS / linux`.
- `src/daemon/ipc-server.ts:41-76` and the IPC tests use that shared path law.

## Resolution
- Updated `spec/03.md` to say `macOS / Linux`.

## Self-Review
- Task offset: the change corrected a spec wording drift and did not alter runtime behavior.
- Task residue: none after `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`.
