---
title: "Create-placeholder action packs a fake filesystem path"
state: closed
github_issue_status: closed
label: "events"
resolution: "Fixed by modeling placeholders as generated package atoms and publishing a scheduler-created v0.0.0 artifact."
---

## Summary
The `create-placeholder` event is modeled as a filesystem publish and the Events UI sends `path: "/"`, so confirming the action attempts to pack the system root instead of publishing a generated v0.0.0 placeholder package.

## Impact
The spec's first-class placeholder action cannot work reliably. It treats a projection field (`path`) as ontology, creating a visible pending card that conserves to no real package source.

## Evidence
- `spec/01.md:9` identifies publishing a `v0.0.0` placeholder as a common core workflow.
- `spec/06.md:33` lists "创建新包 (v0.0.0 占坑)" as a GUI-created Event action.
- `webui/src/routes/+page.svelte:39-42` creates `create-placeholder` with `{ name: 'new-package', path: '/' }`.
- `src/shared/index.ts:180-183` models `CreatePlaceholderContext` as `{ name, path }`.
- `src/daemon/scheduler.ts:247-282` routes `create-placeholder` into `runPublish()`, which packs `ctx.path`.
- `src/shared/index.ts:180-183` now models `CreatePlaceholderContext` as package identity only.
- `src/daemon/scheduler.ts:141-145` now parses placeholder payloads without a filesystem path.
- `src/daemon/scheduler.ts:247-248` now routes placeholders to a dedicated `runPlaceholder()` path.
- `src/daemon/scheduler.ts:326-369` now creates a temporary minimal package with version `0.0.0`, packs it, and publishes that artifact.
- `webui/src/routes/+page.svelte:39` now emits `{ name: 'new-package' }` without a fake path.
- `test/unit/proactive-events.test.ts:113-142` verifies placeholder confirmation publishes a generated `0.0.0` package.

## Resolution
Made `create-placeholder` a generated package atom owned by the scheduler. The event carries only package identity; confirmation creates and publishes a minimal temporary `0.0.0` artifact.

## Self-Review
- Task drift: the fix removed the path projection from the event ontology instead of preserving a compatibility branch for `{ path: "/" }`.
- Task residue: no known residual after root typecheck, Svelte check, focused proactive-events tests, publish-intercept E2E, and a grep check for stale placeholder path usage.
