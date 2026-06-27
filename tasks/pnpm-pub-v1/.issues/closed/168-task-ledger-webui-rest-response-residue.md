---
title: Older WebUI WebSocket residue stayed current after REST decoder closure
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

Milestone 115 and issue `119-webui-ws-message-decoding.md` still described WebUI REST responses as using local response-shape assertions after `res.json()` after issue 120 had already moved those routes and store actions onto shared REST response decoders.

## Impact

The task ledger is the LOOP source for future iterations. Leaving this REST response residue as current would pull later work toward an already-resolved WebUI transport boundary and make historical self-review prose compete with the live decoder law.

## Evidence

- `webui/src/lib/rest-response.ts:23` defines `parseTokenApplyResponse`.
- `webui/src/lib/rest-response.ts:33` defines `parseExportResponse`.
- `webui/src/lib/rest-response.ts:42` defines `parseImportResponse`.
- `webui/src/lib/rest-response.ts:52` defines `parseOkResponse`.
- `webui/src/routes/add-profile/+page.svelte:37` decodes add-profile responses through `parseTokenApplyResponse`.
- `webui/src/routes/renew/+page.svelte:46` decodes renew responses through `parseTokenApplyResponse`.
- `webui/src/routes/backup/+page.svelte:41` and `webui/src/routes/backup/+page.svelte:92` decode export/import responses through shared REST parsers.
- `webui/src/lib/store.ts:203` decodes risky-workspace confirmation responses through `parseOkResponse`.
- `test/unit/webui-rest-response.test.ts:15` covers the shared decoder atom.
- `tasks/pnpm-pub-v1/.issues/closed/120-webui-rest-response-decoding.md:31` records the original REST decoder closure.

## Resolution

Updated the older ledger projection:

```text
Response.json()
    |
    v
shared REST response parser
    |
    v
route/store projection state
```

Milestone 115 and issue 119 now point to the later issue 120 closure instead of describing local REST response assertions as current.

## Self-Review

Task offset: this round corrected task-ledger projection only; it did not change WebUI route behavior, daemon endpoint contracts, or REST parser code.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
