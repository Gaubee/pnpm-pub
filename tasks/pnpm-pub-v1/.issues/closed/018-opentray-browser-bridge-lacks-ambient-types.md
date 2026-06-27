---
title: "Opentray browser bridge lacks ambient types"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
`webui/src/lib/components/window-drag-region.svelte` now reads the opentray bridge through an app-level ambient browser declaration.

## Impact
The WebUI drag-region boundary no longer depends on an `as unknown as` escape hatch. The native window-control bridge is typed at the browser boundary where opentray injects it.

## Evidence
- `webui/src/opentray.d.ts:1-20` adds a browser ambient declaration for `Navigator.opentrayWindow` and `Navigator.opentray`.
- `webui/src/lib/components/window-drag-region.svelte:33-72` now reads the bridge directly from `navigator` without a cast.
- `webui/src/lib/store.ts:7-30` already treats the opentray host injection as a real browser-side contract, and the drag-region now uses the same surface.

## Resolution
Added an app-level ambient declaration for the opentray browser bridge and removed the navigator cast from the drag-region component.

## Self-Review
- Task drift: the fix stayed inside the browser bridge boundary and did not widen the opentray runtime surface.
- Task residue: no known residual after root typecheck, WebUI check, and the focused validator pass.
