---
title: "Renew route projections lacked focused regression coverage"
state: closed
github_issue_status: closed
label: "test-coverage"
---

## Summary

The renew page had route-specific projections for heading, document title, submit labels, and fallback errors, but those projections were only protected by Svelte and TypeScript checks. A future edit could accidentally make `action-required` or direct routes say `Renew Token` again without a focused behavior test failing.

## Impact

Chapter 6.2 treats `Expired` and `Action Required` as separate credential-renewal sources. The projection rule is small and deterministic, so it should live in a typed atom with a narrow regression instead of being scattered through the Svelte route.

## Evidence

- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/src/lib/renew-projection.ts:1` now exposes the typed renew-route reason ontology.
- `webui/src/lib/renew-projection.ts:36` normalizes unknown or missing query values to the direct-route projection.
- `webui/src/routes/renew/+page.svelte:26` now consumes the projection atom instead of hard-coding route copy.
- `test/unit/renew-projection.test.ts:10` now asserts expired, action-required, direct, and unknown-query projection behavior.

## Resolution

- Extracted renew route copy into `webui/src/lib/renew-projection.ts`.
- Updated the Svelte route to render heading, title, submit labels, and fallback errors from the projection atom.
- Added `test/unit/renew-projection.test.ts` as a focused regression for the route source projections.

## Self-Review

- Task offset: this round adds unit-level projection coverage, not a browser-level SvelteKit route render.
- Task residue: the rendered renew route-state browser evidence gap was later resolved by `tasks/pnpm-pub-v1/.issues/closed/170-renew-route-state-browser-regression.md`.
