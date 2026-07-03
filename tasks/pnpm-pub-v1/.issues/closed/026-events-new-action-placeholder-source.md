---
title: "Events New Action menu used hardcoded demo payloads"
state: closed
github_issue_status: closed
label: "ui"
---

## Summary

`webui/src/routes/+page.svelte` originally seeded the Events "New Action" menu with hardcoded placeholder payloads, including `owner/name` for Trusted Publish and a fixed package name for placeholder creation.

## Impact

That made the Events page manufacture source data instead of taking it from a real user-supplied or workspace-backed context. It violated the source/projection boundary and left the UI capable of emitting fake action identity.

## Evidence

- `webui/src/routes/+page.svelte:31-43` now contains source-backed input handlers instead of hardcoded demo literals.
- `webui/src/routes/+page.svelte:57-95` replaces the old button-only menu with a controlled form that requires explicit package/repo/path input before creating proactive events.
- `test/unit/proactive-events.test.ts:101-118` proves the placeholder event payload stays limited to the user input `reserved-name`.

## Resolution

- Replaced the demo-only Events menu with a small controlled form for placeholder and OIDC actions.
- Kept refresh-token as the only profile-derived quick action.
- Added regression coverage to prove the new action flow no longer relies on fake runtime literals.

## Self-Review

- Task offset: the round stayed inside the UI source/projection boundary and did not widen into unrelated platform code.
- Task residue: none after `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`.
