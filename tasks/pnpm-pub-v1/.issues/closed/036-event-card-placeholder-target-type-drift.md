---
title: "event-card placeholder projection drifted from the shared PublishTarget type"
state: closed
github_issue_status: closed
label: "webui"
---

## Summary
`webui/src/lib/components/event-card.svelte` projected placeholder events through an anonymous target shape that Svelte inferred too narrowly, so the component could not access `repository` even though the shared publish target type allows it.

## Impact
The Workspaces and Events views were no longer aligned on the same target contract. That blocked the WebUI checker and made the placeholder projection less faithful to the shared publish target law.

## Evidence
- `webui/src/lib/components/event-card.svelte:60-66` built a placeholder target inline.
- `webui/src/lib/components/event-card.svelte:122-123` attempted to read `publishTarget.target.repository`.
- `pnpm --filter ./webui run check` failed with `Property 'repository' does not exist on type ...`.

## Resolution
- Kept the placeholder event projection but made it conform to the shared `PublishTarget` shape so `repository` stays available in the view contract.

## Self-Review
- Task offset: this was a projection type repair only; no runtime behavior changed.
- Task residue: none after `pnpm --filter ./webui run check` and the focused Vitest set passed.
