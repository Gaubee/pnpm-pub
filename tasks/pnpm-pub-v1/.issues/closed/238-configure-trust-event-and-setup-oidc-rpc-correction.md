---
title: "Trusted Publishing event model needed configure-trust and setup-oidc split"
state: closed
github_issue_status: closed
label: architecture
milestone: 238
resolution: fixed
---

## Summary

The first Trusted Publishing event refactor incorrectly modeled registry trust writes as `trusted-publishing` / `batch-trusted-publishing` Events and removed the local workflow setup path entirely.

## Impact

That blurred two different sources of action: npm `/trust` registry mutation and local `.github/workflows/publish.yml` setup. It also made batch configuration a special aggregate event instead of independent audited package actions.

## Evidence

- `src/shared/schemas.ts` now exposes `configure-trust` as the only Trusted Publishing mutation Event.
- `webui/src/lib/components/trusted-publishing-dialog.svelte` creates N `configure-trust` Events with a shared `groupId` for batch selection.
- `src/daemon/oidc-workflow.ts` and `src/shared/orpc-contract.ts` restore `setup-oidc` as preview/write RPC for local workflow files only.
- `webui/src/lib/components/event-card.svelte` owns compact/full form mode and persists it through `preferences.values` with Zod safe parsing.
- `test/unit/proactive-events.test.ts`, `test/unit/store.test.ts`, `test/unit/oidc-workflow.test.ts`, and `test/browser/trusted-publishing-dialog-event.test.ts` cover the corrected laws.

## Resolution

Replaced the temporary event names with `configure-trust`, removed the aggregate batch event, restored local OIDC workflow preview/write as RPC, and added the backend free-form preference record used by the EventCard form mode toggle.

## Self-Review

- Task drift: kept the correction inside Trusted Publishing, setup-oidc workflow, preferences, and task/spec docs.
- Task residue: no direct `oidc.addTrust` / `oidc.removeTrust` write surface was reintroduced; local setup-oidc does not touch npm `/trust`.
