---
title: Renew route-state projections needed browser-level evidence
state: closed
github_issue_status: closed
label: test-coverage
resolution: fixed
---

## Summary

The renew route projection atom had unit coverage and the browser lane checked document titles, but the rendered SvelteKit route still lacked browser evidence for the visible heading, submit label, and default fallback error states. The route is the user-facing projection wall for Chapter 6.2 credential renewal states, so the DOM needed to prove the same source separation.

## Impact

Without browser-level route-state coverage, a future Svelte route edit could keep the projection atom green while wiring the rendered heading, submit control, or fallback error back to expired-token copy for neutral credential re-apply routes.

## Evidence

- `webui/src/lib/renew-projection.ts:12` defines the expired-token projection.
- `webui/src/lib/renew-projection.ts:21` defines the credential re-apply projection.
- `webui/src/routes/renew/+page.svelte:28` derives the route reason from the SvelteKit page URL.
- `webui/src/routes/renew/+page.svelte:79` renders the heading from the projection.
- `webui/src/routes/renew/+page.svelte:61` renders the default error fallback from the projection when the daemon response has no explicit error.
- `webui/src/routes/renew/+page.svelte:114` renders the submit label from the projection.
- `test/browser/renew-route-title.test.ts:220` now asserts rendered title, heading, and submit label for expired, action-required, and direct routes.
- `test/browser/renew-route-title.test.ts:238` now mocks a daemon renew failure in the browser and asserts the route-specific fallback error copy.

## Resolution

Extended the existing browser-backed renew route regression:

```text
route query reason
    |
    v
renew projection atom
    |
    v
rendered SvelteKit route
    |
    v
browser DOM evidence
```

The browser lane now proves expired-token and credential re-apply projections stay separate for document title, heading, submit label, and default fallback error.

## Self-Review

Task offset: this round added browser-level route-state evidence only; it did not change renew API behavior, daemon Event ontology, or projection copy.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
