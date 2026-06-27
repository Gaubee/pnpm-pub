---
title: "spec/05.md understated the WebToken as 64-bit"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary
`spec/05.md` described the daemon WebToken as a 64-bit random token, while the security chapter and implementation generate 32 random bytes rendered as 64 hex characters.

## Impact
The core-service chapter weakened the apparent UI authorization law. A reader could mistake the 64-character projection for the actual entropy source and believe the WebToken boundary was only 64 bits.

## Evidence
- `spec/05.md:30` previously said the daemon generates a `64 位` random `WebToken`.
- `spec/03.md:37` defines the token as `crypto.randomBytes(32).toString('hex')`.
- `src/daemon/index.ts:85` uses `randomHex(32)`, documented as 64 hex characters and 256 bits.

## Resolution
- Updated `spec/05.md` to state that the WebToken is 256-bit random material represented as 64 hexadecimal characters.

## Self-Review
- Task offset: this corrected security-law wording only; runtime token generation stayed unchanged.
- Task residue: none after stale wording search, `pnpm typecheck`, WebToken E2E coverage, and `git diff --check`.
