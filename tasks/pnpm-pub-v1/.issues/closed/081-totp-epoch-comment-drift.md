---
title: "TOTP epoch helper comment described obsolete clock mutation"
state: closed
github_issue_status: closed
label: "contract-doc"
---

## Summary
The exported `generateTotpAt` helper comment said the implementation temporarily monkey-patched `Date.now`, but the current implementation uses an epoch-scoped cloned otplib TOTP instance.

## Impact
Chapter 8.4 depends on generating a server-time-compensated TOTP without widening global process effects. The stale comment made the helper look like it mutated the process clock, which misrepresented the source-of-action boundary around clock-drift recovery.

## Evidence
- `src/daemon/totp.ts:27` now states that Chapter 8.4 uses a server-supplied time without mutating the process clock.
- `src/daemon/totp.ts:28` now names the cloned otplib TOTP instance as the scoped mechanism.
- `src/daemon/totp.ts:31` still uses `totp.clone({ epoch: epochMs }).generate(secret)`.

## Resolution
- Updated the exported helper comment to match the current implementation.
- Kept runtime TOTP and clock-drift behavior unchanged.
- Verified the TOTP and drift regression suites.

## Self-Review
- Task offset: this round corrects contract documentation for the TOTP atom; it does not change runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
