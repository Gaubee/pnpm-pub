---
title: "Interrupted pending publish events stayed pending or looked rejected"
state: closed
github_issue_status: closed
label: daemon
milestone: 242
resolution: fixed
---

## Summary

Pending publish Events did not have a distinct terminal status for non-WebUI interruption. A CLI-owned publish task could lose its terminal owner, or a daemon restart could orphan pending rows, while the WebUI still projected the task as pending or reused the rejected visual bucket without source distinction.

## Impact

The status ontology blurred two different sources of action. `rejected` means the WebUI user actively refused the Event. CLI disconnects, killed publish commands, and daemon restarts are different causes and must resolve to `canceled` so history does not claim a WebUI rejection that never happened.

## Evidence

- `src/daemon/event-db.ts` previously swept restart-orphaned pending rows to `failed`.
- `src/daemon/ipc-server.ts` did not bind the CLI socket lifetime to the created pending publish Event.
- `src/daemon/scheduler.ts` had no non-WebUI cancellation transition, and `reject()` could still rewrite any live pending entry.
- `webui/src/lib/types.ts` duplicated status literals instead of aliasing the shared `EventStatus` source.

## Resolution

Added `canceled` to the shared Event status ontology, persisted it as history, and changed daemon restart sweeps to resolve orphan pending rows as canceled. The IPC server now tracks the pending Event created for a CLI publish request and asks the scheduler to cancel it when the client socket disappears before confirmation. The scheduler now distinguishes `awaiting-decision` from `executing`, so cancellation and rejection cannot rewrite an action after confirmation starts. The WebUI imports the shared status type and renders `canceled` with the same muted projection family as `rejected` while preserving the distinct source name. The same IPC/Event wall now also hosts CLI Trusted Publishing intent through pending `configure-trust` Events, keeping the non-publish action source on the WebUI confirmation path.
