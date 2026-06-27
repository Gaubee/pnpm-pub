---
title: Older JSON assertion residues stayed current after later decoder rounds
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Older milestone and issue self-review text still described the IPC frame, decrypted backup, and package manifest JSON assertion boundaries as current after later decoder rounds had resolved them. The runtime source law was already correct; the task ledger projection lagged behind the closed issue chain.

## Impact

The stale ledger text could pull future rounds back into already-closed decoder work. That blurs the system's source/projection boundary: live source code and later closure evidence proved the boundaries were resolved, while older self-review prose still looked like active residue.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md:2707` now points Milestone 118 residue at issues 123, 124, and 125.
- `tasks/pnpm-pub-v1/TASKS.md:2732` now points Milestone 119 residue at issues 124 and 125.
- `tasks/pnpm-pub-v1/TASKS.md:2756` now points Milestone 120 residue at issue 125.
- `tasks/pnpm-pub-v1/.issues/closed/122-daemon-store-persistent-json-decoding.md:52` now links to the later decoder closures.
- `tasks/pnpm-pub-v1/.issues/closed/123-ipc-frame-unknown-decoding.md:50` now links to the later crypto and package-version closures.

## Resolution

Corrected the ledger projection without changing runtime code:

```text
old self-review residue
    |
    v
later decoder issues 123/124/125
    |
    v
current task ledger
```

The source law remains: transport, decrypted, and manifest JSON enter as `unknown` and become ontology only through explicit guards.

## Self-Review

Task offset: this round stayed in task-ledger projection cleanup and did not change IPC framing, crypto import, package-version resolution, CLI handshake behavior, or daemon persistence.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
