---
title: Backup import promoted decrypted JSON through a ProfileSecrets assertion
state: closed
github_issue_status: closed
label: type-safety
resolution: fixed
---

## Summary

`src/daemon/crypto.ts` decrypted backup ciphertext and returned `JSON.parse(...) as ProfileSecrets`. Chapter 3.1 treats Token and TOTP Secret material as high-priority credential ontology, and Chapter 8.2 imports decrypted Token/Secret values into the OS keychain. Authenticated plaintext should therefore be decoded as `unknown` before it can become profile secret truth.

## Impact

A backup payload with a valid password and valid AES-GCM tag but malformed plaintext shape could enter the import path as typed secrets. That weakens the credential lifecycle law by letting decrypted projection data masquerade as `{ token, totp }` ontology.

## Evidence

- `src/daemon/crypto.ts:101` now parses decrypted plaintext as `unknown`.
- `src/daemon/crypto.ts:102` promotes decrypted data only through `parseProfileSecrets`.
- `src/daemon/crypto.ts:118` validates the top-level decrypted value is a record.
- `src/daemon/crypto.ts:121` iterates profile entries as source records.
- `src/daemon/crypto.ts:122` requires each secret entry to contain string `token` and string `totp`.
- `test/unit/crypto.test.ts:32` verifies authenticated plaintext with an invalid secret shape fails closed.
- `test/unit/crypto.test.ts:43` verifies authenticated non-JSON plaintext fails closed.
- `test/unit/crypto.test.ts:68` builds a valid AES-GCM test bundle so the regression covers post-authentication decoding, not only wrong-password failure.

## Resolution

Replaced the decrypted JSON assertion with an explicit secret decoder:

```text
backup ciphertext
    |
    v
AES-GCM auth + decrypt
    |
    v
JSON.parse -> unknown
    |
    v
parseProfileSecrets -> keychain import source
```

Invalid decrypted plaintext now returns `null`, matching the existing fail-closed import behavior for bad passwords and tampered ciphertext.

## Self-Review

Task offset: this round stayed at the backup import credential boundary and did not change encryption format, key derivation parameters, WebUI backup preview parsing, keychain persistence, or profile metadata storage.

Task residue: the package-version manifest assertion residue was later resolved by `tasks/pnpm-pub-v1/.issues/closed/125-package-version-manifest-decoding.md`. Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
