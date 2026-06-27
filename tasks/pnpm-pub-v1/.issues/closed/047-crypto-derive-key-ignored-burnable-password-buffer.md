---
title: "Crypto key derivation ignored the burnable password buffer"
state: closed
github_issue_status: closed
label: "security"
---

## Summary
`exportBundle()` and `importBundle()` created `pwBuf = Buffer.from(password, 'utf8')`, but `deriveKey()` accepted the original string and allocated a separate internal password buffer for PBKDF2. The visible `pwBuf.fill(0)` therefore did not erase the actual buffer used by key derivation.

## Impact
The backup crypto layer appeared to obey Chapter 8's burn-after-read law, but the source buffer used for PBKDF2 remained hidden inside `deriveKey()`. That made the burn boundary weaker and harder to audit.

## Evidence
- `src/daemon/crypto.ts:28-33` now requires `deriveKey()` callers to pass a caller-owned `Buffer`.
- `src/daemon/crypto.ts:48-68` now derives export keys from `pwBuf` and burns the password, plaintext, and key buffers in `finally`.
- `src/daemon/crypto.ts:83-105` now derives import keys from `pwBuf` and burns the password, plaintext, and key buffers in `finally`.
- `test/unit/crypto.test.ts:49-76` now exercises the buffer-based `deriveKey()` contract.

## Resolution
- Changed `deriveKey()` to take a `Buffer` instead of a string.
- Routed export/import key derivation through the burnable caller-owned password buffer.
- Replaced ad hoc `fill(0)` calls with the shared `burnBuffer()` primitive.

## Self-Review
- Task offset: this is an internal crypto boundary tightening; the exported backup bundle format and password semantics remain unchanged.
- Task residue: public crypto functions still receive `password: string` because callers parse JSON/form data as strings. The first crypto-owned source buffer is now the actual PBKDF2 input and is burned.
