---
title: WebUI backup import file decoder lives inside route with typed record projection
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`webui/src/routes/backup/+page.svelte` owned the imported backup-file shape guard and projected the parsed JSON through `Partial<Record<keyof BackupBundle, unknown>>`. Chapter 8.2 defines the backup file wrapper as imported user content with plaintext profile metadata plus encrypted payload fields, so that file content should be decoded at a dedicated boundary before route state uses it.

## Impact

Keeping the file decoder inside the route mixes interaction state with import-file ontology and leaves a local typed projection in a Svelte page. That makes it harder to reuse and test the backup wrapper law independently from the visual import/export flow.

## Evidence

- `webui/src/lib/backup-bundle.ts:3` now defines the backup bundle parse result.
- `webui/src/lib/backup-bundle.ts:7` now parses backup file text as `unknown` JSON before accepting the wrapper shape.
- `webui/src/lib/backup-bundle.ts:16` now validates the Chapter 8.2 wrapper fields without the route-local `Partial<Record<...>>` projection.
- `webui/src/routes/backup/+page.svelte:12` imports the parser instead of owning the structural guard.
- `webui/src/routes/backup/+page.svelte:60` and `webui/src/routes/backup/+page.svelte:76` now use the parser for preview and import.
- `test/unit/webui-backup-bundle.test.ts:10` covers the decoder.
- `test/unit/webui-backup-bundle.test.ts:32` verifies malformed JSON is distinguished from wrong backup shape.
- `test/unit/webui-backup-bundle.test.ts:36` verifies invalid profile metadata is rejected.

## Resolution

Extracted the backup wrapper decoder:

```text
user backup file text
    |
    v
JSON parse + BackupBundle guard
    |
    v
backup route preview/import state
```

The backup route no longer owns the imported-file structural law, and the old typed record projection is gone from live WebUI code.

## Self-Review

Task offset: this round stayed at the backup import-file decoding boundary and did not change daemon import/export contracts, encryption format, or route layout.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
