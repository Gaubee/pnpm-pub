---
title: "Backup import preview cast raw JSON instead of validating the bundle shape"
state: closed
github_issue_status: closed
label: "webui"
---

## Summary

`webui/src/routes/backup/+page.svelte` parsed pasted backup JSON and cast it directly to a loose `{ profiles?: string[] }` shape for preview, then sent an unvalidated parsed value to `/api/import`.

## Impact

The server-side import endpoint already enforced the `BackupBundle` ontology, but the WebUI projection let arbitrary JSON pass through preview/import preparation. That made the view boundary weaker than the shared backup contract.

## Evidence

- `webui/src/routes/backup/+page.svelte:53` previously cast `JSON.parse(importBundle)` to `{ profiles?: string[] }`.
- `webui/src/routes/backup/+page.svelte:69` previously sent raw parsed JSON as the import bundle.
- `src/daemon/web-server.ts:619-640` already validates the full `BackupBundle` shape at the server boundary.

## Resolution

- Added a WebUI-side `BackupBundle` type guard that checks `profiles`, `salt`, `iv`, and `ciphertext`.
- Routed both preview and import through that guard so the UI projection matches the server contract.

## Self-Review

- Task offset: this is a projection-boundary type-safety fix; it does not change the encrypted backup format.
- Task residue: none after WebUI check, backup/crypto-focused unit tests, stale parse search, and `git diff --check`.
