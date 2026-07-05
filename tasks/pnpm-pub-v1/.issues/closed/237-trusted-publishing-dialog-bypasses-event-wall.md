---
title: "Trusted Publishing dialog bypasses the Event wall"
state: closed
github_issue_status: closed
label: webui
milestone: 237
resolution: fixed
---

## Summary

Trusted Publishing configuration was modeled as an OIDC dialog/workflow action instead of an Event-owned npm `/trust` mutation.

## Impact

Trusted Publishing writes are registry-side external effects. Letting the dialog or a direct OIDC RPC own the write path blurred the source of action, made batch configuration harder to confirm package-by-package, and kept the UI projection coupled to an obsolete workflow-generation ontology.

## Evidence

- `src/shared/schemas.ts` now defines `configure-trust` Event payloads as the source ontology.
- `src/daemon/scheduler.ts` confirms `configure-trust` Events through `addTrustedPublisher` / `removeTrustedPublisher` from `src/daemon/trusted-publishing-api.ts` and invalidates the trust cache after registry mutation.
- `webui/src/lib/components/trusted-publishing-dialog.svelte` now creates one `configure-trust` Event per selected target or shows the current-config/batch confirmation projection.
- `webui/src/lib/components/event-card.svelte` owns the pending Event draft form before confirmation.
- `test/unit/proactive-events.test.ts` covers add, update, remove, grouped batch, failure, and missing-draft behavior through the pending wall.

## Resolution

Replaced registry-side Trusted Publishing writes with the `configure-trust` Event ontology. Batch selection now creates N independent `configure-trust` Events sharing `groupId`; `setup-oidc` is restored only as local workflow preview/write RPC and does not perform npm `/trust` writes.

## Self-Review

- Task drift: the refactor stayed inside the Trusted Publishing/OIDC boundary; unrelated tray/sidebar/settings work already present in the dirty tree was not absorbed.
- Task residue: none after typecheck, WebUI check, focused Trusted Publishing/store/protocol tests, stale OIDC runtime/reference audit, task issue validation, and whitespace diff validation.
