---
title: Older WebUI REST residue stayed current after backup bundle decoder closure
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestone 116 and issue `120-webui-rest-response-decoding.md` still described `webui/src/routes/backup/+page.svelte` as owning a local `BackupBundle` structural guard with an internal typed record projection after issue 121 had already extracted that import-file decoder.

## Impact

The task ledger is the LOOP source for future iterations. A stale route-local decoder residue would pull later work toward an already-resolved WebUI import-file ontology boundary instead of the remaining live task residue.

## Evidence

- `webui/src/routes/backup/+page.svelte:12` imports `parseBackupBundleJson`.
- `webui/src/routes/backup/+page.svelte:60` uses the parser for preview.
- `webui/src/routes/backup/+page.svelte:76` uses the parser before import.
- `webui/src/lib/backup-bundle.ts:7` parses backup file text as `unknown` JSON.
- `webui/src/lib/backup-bundle.ts:16` owns the wrapper guard.
- `test/unit/webui-backup-bundle.test.ts:10` covers the decoder.
- `tasks/pnpm-pub-v1/.issues/closed/121-webui-backup-bundle-decoding.md:31` records the original decoder extraction.

## Resolution

Updated the older ledger projection:

```text
user backup file text
    |
    v
parseBackupBundleJson
    |
    v
backup route preview/import state
```

Milestone 116 and issue 120 now point to the later issue 121 closure instead of stating that the route-local backup decoder is still current.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change WebUI route behavior, daemon import/export contracts, or encryption format.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
