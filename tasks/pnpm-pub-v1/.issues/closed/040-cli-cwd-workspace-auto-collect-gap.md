---
title: "CLI publish CWD did not auto-collect the workspace root"
state: closed
github_issue_status: closed
label: "workspace"
---

## Summary
`PublishScheduler.intercept()` accepted CLI publish intents but never rooted and recorded the incoming CWD as a workspace, even though Chapter 5 requires CLI CWD to flow through the workspace auto-collection law.

## Impact
Workspaces could only be populated through the WebUI scan path. That split the source of action: a terminal publish knew the CWD and package target, but the workspace ontology did not learn the safe project root.

## Evidence
- `spec/05.md:36-41` requires daemon auto-collection and root discovery when a CLI CWD is received.
- `src/daemon/scheduler.ts:192-225` previously created the pending publish event without calling workspace root discovery or `store.addWorkspace()`.
- `src/daemon/web-server.ts:289-333` already applied the root/risk law for WebUI workspace scans, proving the missing path was specific to CLI publish intercepts.

## Resolution
- Added scheduler-side workspace collection for CLI publish CWDs.
- Safe rooted projects are persisted through `store.addWorkspace()`.
- Risky roots are not persisted and are reported to the CLI stderr stream.
- Added a regression proving a package-level CWD inside a monorepo records the workspace root while preserving the publish event CWD.

## Self-Review
- Task offset: the new behavior mounts to the existing root/risk workspace law and store boundary; it does not create a sibling workspace source.
- Task residue: none after focused scheduler/workspace/store tests, `pnpm typecheck`, and `git diff --check`.
