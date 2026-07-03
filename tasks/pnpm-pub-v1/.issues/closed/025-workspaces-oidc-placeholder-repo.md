---
title: "Workspaces OIDC action used a placeholder repository slug"
state: closed
github_issue_status: closed
label: "ui"
---

## Summary

`webui/src/routes/workspaces/+page.svelte` was creating `setup-oidc` events with a hardcoded `repo: 'owner/name'`, so the UI was manufacturing repository identity instead of passing source-backed package metadata through the daemon.

## Impact

The OIDC workflow was anchored to a fake repository slug. That breaks the source/projection law: the WebUI should project package facts, not invent repo identity, and the daemon should not receive a placeholder that can only be wrong.

## Evidence

- `webui/src/routes/workspaces/+page.svelte:153-171` created `setup-oidc` with `repo: 'owner/name'`.
- `src/daemon/scheduler.ts:126-133` required `repo` as part of the OIDC payload.
- `webui/src/lib/components/event-card.svelte:128-129` rendered the repo field back into the event projection, so the fake slug was user-visible.

## Resolution

- Added repository metadata to scanned packages in `src/daemon/workspace.ts`.
- Threaded that metadata through `src/daemon/web-server.ts`, `src/daemon/scheduler.ts`, and `webui/src/lib/types.ts`.
- Updated the Workspaces UI to only emit `setup-oidc` when real repository metadata exists, and to stop manufacturing a fake slug.
- Added regression coverage in `test/unit/workspace.test.ts` and `test/unit/proactive-events.test.ts`.

## Self-Review

- Task offset: the round stayed on the source/projection boundary and did not widen into unrelated UI work.
- Task residue: none after `pnpm exec vitest run test/unit/workspace.test.ts test/unit/proactive-events.test.ts test/unit/cli-handshake.test.ts test/unit/cli-stop.test.ts test/unit/ipc-server.test.ts`.
