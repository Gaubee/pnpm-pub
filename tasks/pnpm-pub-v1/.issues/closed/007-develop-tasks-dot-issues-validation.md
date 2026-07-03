---
title: "Develop-tasks validator does not discover the task .issues ledger"
state: closed
github_issue_status: closed
label: "task-workflow"
resolution: "Fixed by adding a task-local `.issues` validator at `tasks/pnpm-pub-v1/scripts/issues.ts`."
---

## Summary

The bundled develop-tasks validation script only scans `issues/` paths, while this task's required ledger lives under `tasks/pnpm-pub-v1/.issues/`.

## Impact

Issue files for this task must currently be validated manually against the skill rules, which weakens the task-led iteration loop.

## Evidence

- `tasks/pnpm-pub-v1/.issues/closed/005-renew-rollback-state.md` and `tasks/pnpm-pub-v1/.issues/closed/006-renew-missing-secret-recovery.md` follow the required front matter and body shape.
- `bun .agents/skills/develop-tasks/scripts/issues.ts tasks/pnpm-pub-v1 validate` returned `no valid issue files found`.
- `.agents/skills/develop-tasks/scripts/issues.ts` filters paths by `/issues/` and does not match `/.issues/`.
- `tasks/pnpm-pub-v1/scripts/issues.ts` now provides a durable project-local validation and archive path for `.issues/`.
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed` validates all seven task issue records.
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate` returns `no valid issue files found`, proving there are no active unclosed issue records after this round.

## Resolution

Added a task-local validator/archive helper that treats `tasks/pnpm-pub-v1/.issues/` as this task's issue ontology while keeping archived records out of the active query.

## Self-Review

- Task drift: an initial local edit to ignored `.agents/` skill files was rejected as non-durable repo evidence. The final fix is under the tracked task artifact boundary instead.
- Task residue: no active `.issues` records remain after archiving issue 007; the next iteration can start from the spec ledger rather than a workflow-tooling blocker.
