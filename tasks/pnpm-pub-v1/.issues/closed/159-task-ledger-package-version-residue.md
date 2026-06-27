---
title: Crypto decoding issue kept stale package-version residue after later fix
state: closed
github_issue_status: closed
label: task-ledger
resolution: fixed
---

## Summary

`tasks/pnpm-pub-v1/.issues/closed/124-crypto-decrypted-secret-decoding.md` still said `src/shared/package-version.ts` contained package manifest JSON assertions after the later package-version round had already closed that boundary. The ledger projection had fallen behind the implementation and the follow-up issue record.

## Impact

The stale residue made the task ledger point future rounds at an already-resolved release-truth boundary. That wastes review effort and weakens the distinction between current source truth and historical self-review notes.

## Evidence

- `tasks/pnpm-pub-v1/.issues/closed/124-crypto-decrypted-secret-decoding.md:51` now points to issue 125 instead of claiming the package-version assertion still exists.
- `tasks/pnpm-pub-v1/.issues/closed/125-package-version-manifest-decoding.md:19` records the package-version reader resolution.
- `src/shared/package-version.ts:38` reads manifest JSON as `unknown`.
- `src/shared/package-version.ts:41` validates the manifest through `parsePackageManifest`.

## Resolution

Updated the stale issue 124 self-review residue to point at the later issue 125 resolution:

```text
old residue projection
    |
    v
live package-version evidence + issue 125
    |
    v
corrected task ledger
```

This round intentionally did not touch runtime code; the source law was already correct.

## Self-Review

Task offset: this round stayed in the task-ledger projection layer and did not reopen package-version behavior, CLI handshake behavior, daemon boot flow, or JSON decoder implementation.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
