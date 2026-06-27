---
title: "spec/07.md still named the old run.sock path"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary
`spec/07.md` still described the CLI socket as `~/.pnpm-pub/run.sock`, while the actual IPC law used `~/.pnpm-pub/run/pnpm-pub.sock`.

## Impact
That made Chapter 7 contradict the rest of the IPC contract and the implementation. The spec itself was the stale source of truth.

## Evidence
- `spec/07.md:25` previously named `~/.pnpm-pub/run.sock`.
- `spec/03.md:28`, `src/shared/paths.ts:45-59`, and the IPC tests all use `~/.pnpm-pub/run/pnpm-pub.sock`.

## Resolution
- Updated `spec/07.md` to use the same socket path law as Chapter 3 and the implementation.

## Self-Review
- Task offset: the change corrected a stale spec line and did not alter runtime behavior.
- Task residue: none after `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`.
