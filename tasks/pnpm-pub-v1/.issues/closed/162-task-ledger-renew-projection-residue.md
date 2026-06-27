---
title: Older renew projection residues stayed current after later closures
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Older renew milestones and issue self-reviews still described expired-token copy, direct-route copy, document title, submit label, and default error fallback problems as current residue. Later renew projection rounds had already closed those projection boundaries and added focused regression coverage.

## Impact

The stale ledger text could pull future LOOP rounds back into already-closed UI projection work. Chapter 6.2 keeps `Expired` and `Action Required` as separate credential-renewal sources, so the task ledger should reflect the current route-source projection law instead of historical residue.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md:1050` now points the action-required copy residue at issue 065.
- `tasks/pnpm-pub-v1/TASKS.md:1084` now points the direct-route copy residue at issue 066.
- `tasks/pnpm-pub-v1/TASKS.md:1101` now points the document-title residue at issue 067.
- `tasks/pnpm-pub-v1/TASKS.md:1118` now points the submit-label residue at issue 068.
- `tasks/pnpm-pub-v1/TASKS.md:1135` now points the default-error residue at issue 069.
- `webui/src/lib/renew-projection.ts:12` keeps expired-token copy only for explicit expired routes.
- `webui/src/lib/renew-projection.ts:21` keeps action-required and direct routes on credential re-apply copy.
- `test/unit/renew-projection.test.ts:11` covers expired, action-required, direct, and unknown route reasons.
- `test/browser/renew-route-title.test.ts:127` covers browser document titles for expired, action-required, and direct routes.

## Resolution

Corrected the ledger projection without changing WebUI runtime code:

```text
old renew residue chain
    |
    v
issues 065 / 066 / 067 / 068 / 069 / 070 / 072
    |
    v
current renew projection ledger
```

The current route-source law remains: only `reason=expired` projects token renewal; `action-required` and direct routes project credential re-apply.

## Self-Review

Task offset: this round stayed in task-ledger projection cleanup and did not change renew route behavior, scheduler status ontology, Event routing, or browser test infrastructure.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
