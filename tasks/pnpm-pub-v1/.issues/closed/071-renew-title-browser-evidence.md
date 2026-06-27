---
title: "Renew document-title projection lacked browser evidence"
state: closed
github_issue_status: closed
label: "verification"
---

## Summary
The renew route projection atom had unit coverage, but the task ledger still recorded that no browser-level evidence proved SvelteKit wrote the projected document title into the actual page head.

## Impact
Chapter 6.2 keeps `Expired` and `Action Required` as separate credential-renewal sources. The document title is visible browser chrome projection, so the acceptance evidence should prove the routed SvelteKit page preserves that distinction after hydration.

## Evidence
- `spec/06.md:25` defines `Expired` / `Action Required` as separate credential-renewal sources.
- `webui/src/lib/renew-projection.ts:15` defines `Renew Token · pnpm-pub` for explicit expired-token routes.
- `webui/src/lib/renew-projection.ts:24` defines `Re-apply Credentials · pnpm-pub` for credential re-apply routes.
- `webui/src/routes/renew/+page.svelte:66` writes `{projection.documentTitle}` into `<svelte:head>`.
- Browser evidence against the live SvelteKit dev server:
  - `/renew?reason=expired` returned `Renew Token · pnpm-pub`.
  - `/renew?reason=action-required` returned `Re-apply Credentials · pnpm-pub`.
  - `/renew` returned `Re-apply Credentials · pnpm-pub`.

## Resolution
- Verified the renew route document title in a real browser with `agent-browser` against the local SvelteKit dev server.
- Preserved runtime code unchanged; the projection atom and Svelte route already matched the source law.

## Self-Review
- Task offset: this round closes a verification-evidence residue rather than changing implementation.
- Task residue: the browser-title acceptance was later committed as an automated regression by `tasks/pnpm-pub-v1/.issues/closed/072-renew-title-browser-ci-regression.md`, moved into a dedicated browser lane by `tasks/pnpm-pub-v1/.issues/closed/073-renew-browser-test-lane.md`, and added to the default test gate by `tasks/pnpm-pub-v1/.issues/closed/074-default-test-skips-browser-lane.md`.
