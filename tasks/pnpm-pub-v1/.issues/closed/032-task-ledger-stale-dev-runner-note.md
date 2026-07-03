---
title: "TASKS.md milestone note still claimed the dev runner kept mock bootstrap intact"
state: closed
github_issue_status: closed
label: "tasks"
---

## Summary

`tasks/pnpm-pub-v1/TASKS.md` still said Milestone 23 kept the mock profile bootstrap intact, even though later changes removed that bootstrap.

## Impact

The ledger was preserving an obsolete state description. That’s a task-offset problem: the milestone history no longer matched the actual evolution of the dev runner.

## Evidence

- `tasks/pnpm-pub-v1/TASKS.md:375-382` previously described Milestone 23 as keeping the mock profile bootstrap intact.
- `src/daemon/dev.ts:1-54` now shows the dev runner boots without seeded profile/credential state.

## Resolution

- Reworded Milestone 23 to say the dev runner itself stayed minimal while stopping it from manufacturing runtime event truth.

## Self-Review

- Task offset: the fix stayed in the ledger text and did not alter runtime behavior.
- Task residue: none after `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`.
