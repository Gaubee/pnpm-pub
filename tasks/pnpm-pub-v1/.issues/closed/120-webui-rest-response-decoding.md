---
title: WebUI REST routes trust daemon response bodies by assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

The add-profile, renew, backup, and workspace-confirm WebUI paths read daemon REST responses with local shape assertions after `res.json()`. A REST response body is transport input until the WebUI proves the expected daemon response contract.

## Impact

Malformed daemon responses could drive route state as if they were valid protocol facts. That weakens the WebToken-guarded REST boundary and can make UI projections such as manual-token fallback, backup output, import completion, or risky-workspace confirmation reflect unproven data.

## Evidence

- `webui/src/lib/rest-response.ts:23` now validates token apply / renew response bodies.
- `webui/src/lib/rest-response.ts:33` now validates backup export response bodies while keeping the export bundle opaque.
- `webui/src/lib/rest-response.ts:42` now validates backup import response bodies.
- `webui/src/lib/rest-response.ts:52` now validates boolean `{ ok }` responses.
- `webui/src/routes/add-profile/+page.svelte:37` now decodes add-profile responses through `parseTokenApplyResponse`.
- `webui/src/routes/renew/+page.svelte:46` now decodes renew responses through `parseTokenApplyResponse`.
- `webui/src/routes/backup/+page.svelte:58` and `webui/src/routes/backup/+page.svelte:104` now decode export/import responses through REST parsers.
- `webui/src/lib/store.ts:203` now decodes risky-workspace confirmation responses through `parseOkResponse`.
- `test/unit/webui-rest-response.test.ts:15` covers token apply decoding.
- `test/unit/webui-rest-response.test.ts:29` and `test/unit/webui-rest-response.test.ts:33` cover backup export/import decoding.
- `test/unit/webui-rest-response.test.ts:37` covers workspace confirmation response decoding.

## Resolution

Inserted a shared WebUI REST response decoder:

```text
Response.json()
    |
    v
endpoint response guard
    |
    v
route/store state
```

The affected WebUI paths no longer use direct response-shape assertions after `res.json()`.

## Self-Review

Task offset: this round stayed at the WebUI REST response boundary and did not change daemon endpoint contracts, request payloads, or route interaction flow.

Task residue: the backup import-file decoder boundary named here was later resolved by `tasks/pnpm-pub-v1/.issues/closed/121-webui-backup-bundle-decoding.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
