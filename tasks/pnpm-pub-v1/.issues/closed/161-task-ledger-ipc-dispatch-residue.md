---
title: CLI stop issue kept stale IPC private-dispatch residue
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

`tasks/pnpm-pub-v1/.issues/closed/078-cli-stop-double-cast-test-evidence.md` still said `test/unit/ipc-server.test.ts` contained localized double-casts around private `dispatch` access. The later IPC server round had already replaced that implementation-coupled test path with public socket-boundary evidence.

## Impact

The stale residue made the task ledger point future rounds at an already-resolved test architecture boundary. That blurred the distinction between current socket protocol evidence and historical self-review prose.

## Evidence

- `tasks/pnpm-pub-v1/.issues/closed/078-cli-stop-double-cast-test-evidence.md:27` now points to issue 079 instead of describing private-dispatch casts as current.
- `tasks/pnpm-pub-v1/.issues/closed/079-ipc-server-private-dispatch-test-boundary.md:21` records that private `dispatch` access was removed.
- `test/unit/ipc-server.test.ts:29` starts a real `IpcServer` through the public `start()` method.
- `test/unit/ipc-server.test.ts:36` sends frames through `net.createConnection(socketPath())`.
- `test/unit/ipc-server.test.ts:57` promotes decoded values through `isIpcFrame`.

## Resolution

Corrected the stale issue 078 residue to point at issue 079:

```text
old CLI stop self-review residue
    |
    v
issue 079 socket-boundary closure
    |
    v
current task ledger
```

No runtime code changed; the IPC server tests already prove behavior through the public socket law.

## Self-Review

Task offset: this round stayed in task-ledger projection cleanup and did not change CLI stop behavior, IPC server dispatching, socket framing, or scheduler behavior.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
