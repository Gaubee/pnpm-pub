---
title: profiles.json could hydrate empty or duplicate profile usernames
state: closed
github_issue_status: closed
label: state
milestone: 133
resolution: fixed
---

## Summary

Chapter 4.1 defines profile `username` as the unique Profile ID and NPM identity. The loader validated profile object shape, but it still accepted `profiles.json` entries with an empty username or duplicate usernames.

## Impact

An empty or duplicated profile ID weakens the profile ontology that keychain account names depend on. The daemon could hydrate ambiguous identities before later actions projected those records into UI state, credential lookup, or publish confirmation behavior.

## Evidence

- `spec/04.md:14` defines `default` as a pointer to a `profiles[]` username.
- `spec/04.md:22` defines `username` as the unique Profile ID.
- `spec/04.md:42` and `spec/04.md:43` derive keychain account names from `username`.
- `src/daemon/store.ts:252` tracks parsed usernames as the config source set.
- `src/daemon/store.ts:256` rejects duplicate parsed usernames.
- `src/daemon/store.ts:267` rejects empty profile usernames.
- `test/unit/store.test.ts:115` proves an empty username config hydrates to the empty fallback.
- `test/unit/store.test.ts:130` proves duplicate usernames hydrate to the empty fallback.
- `pnpm exec vitest run test/unit/store.test.ts` passes.
- `pnpm typecheck` passes.

## Resolution

Made profile config hydration conserve to one valid profile source per username:

```text
profiles.json
    |
    v
parse profile atoms
    |
    +-- username is non-empty and unseen -> accept profile
    |
    +-- username is empty or duplicate -> reject config
```

## Self-Review

Task offset: this round only hardens load-time profile config identity validation. It does not change profile creation, profile deletion, keychain migration, or WebUI profile presentation behavior.

Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
