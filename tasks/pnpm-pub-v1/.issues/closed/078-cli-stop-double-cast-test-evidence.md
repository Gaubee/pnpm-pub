---
title: "CLI stop regression used a double-cast mock projection"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI stop regression reached into Vitest mock internals with an `as unknown as` double cast to prove that a socket was returned. That assertion described the mock framework projection instead of the IPC request ontology.

## Impact

Chapter 3.2.1 defines the CLI pipe as an action-intent channel, and Chapter 7.1.1 depends on management commands flowing through that protocol. The test should prove the emitted `stop` intent directly while staying inside the repository's TypeScript safety law.

## Evidence

- `test/unit/cli-stop.test.ts:12` now stores decoded `IpcRequest` frames in typed mock state.
- `test/unit/cli-stop.test.ts:23` records only decoded handshake or command frames.
- `test/unit/cli-stop.test.ts:57` now names the regression in Given/When/Then form.
- `test/unit/cli-stop.test.ts:73` now asserts the actual `{ command: 'stop' }` IPC request.

## Resolution

- Removed the `as unknown as` assertion against Vitest mock internals.
- Replaced it with typed IPC-frame recording through `FrameReader`.
- Verified the focused CLI stop regression and project typecheck.

## Self-Review

- Task offset: this round improves test-source evidence and type-safety hygiene; it does not change CLI runtime behavior.
- Task residue: the IPC server private-dispatch test boundary was later resolved by `tasks/pnpm-pub-v1/.issues/closed/079-ipc-server-private-dispatch-test-boundary.md`.
