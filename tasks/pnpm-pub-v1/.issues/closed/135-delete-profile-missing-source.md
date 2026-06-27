---
title: DELETE profile reported success for an unknown profile source
state: closed
github_issue_status: closed
label: protocol
resolution: fixed
---

## Summary

Chapter 4.1 defines `profiles.json` as the public identity source of truth. `DELETE /api/profiles` returned `{ ok: true }` even when the requested username did not exist in that ontology.

## Impact

The API projected a successful identity deletion without a matching source record. That could make the WebUI or caller believe a profile, keychain secret pair, and default-profile state had been changed when no profile was actually present.

## Evidence

- `src/daemon/store.ts:103` now returns `false` when `removeProfile()` receives an unknown username and does not write or emit a profile update.
- `src/daemon/web-server.ts:120` now maps the store result to `200 { ok: true }` or `404 { ok: false, error }`.
- `test/unit/store.test.ts:55` proves unknown profile removal leaves profiles, default identity, and profile events unchanged.
- `test/unit/web-server-renew.test.ts:398` proves `DELETE /api/profiles` for `ghost` returns 404, does not call keychain deletion, and leaves profile truth intact.
- `pnpm exec vitest run test/unit/store.test.ts test/unit/web-server-renew.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Made deletion conserve to the profile source record:

```text
DELETE /api/profiles(username)
    |
    v
profiles.json source record?
    |
    +-- yes -> remove profile + credentials -> ok true
    |
    +-- no  -> no mutation -> 404 ok false
```

## Self-Review

Task offset: this round only changes unknown-profile deletion semantics. It does not change successful deletion, keychain purge behavior for existing profiles, or profile creation.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
