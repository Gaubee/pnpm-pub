---
title: "TOTP RFC 6238 conformance used HOTP surrogate evidence"
state: closed
github_issue_status: closed
label: "test-contract"
---

## Summary

The TOTP conformance test header still described the file as 6-digit HOTP-reference validation, and the RFC 6238 Appendix B test generated the vectors through `hotp.generate(secret, counter)` after manually deriving the time counter.

## Impact

Chapter 10.1.1 requires objective TOTP algorithm evidence. Proving RFC 6238 vectors through a HOTP surrogate blurred the boundary between the TOTP atom under test and the lower HOTP primitive, while the runtime code already uses an epoch-scoped `totp.clone`.

## Evidence

- `test/unit/totp.test.ts:4` now states that the file validates two distinct protocol facts.
- `test/unit/totp.test.ts:6` now names RFC 6238 Appendix B as TOTP time-step evidence through an epoch-scoped otplib clone.
- `test/unit/totp.test.ts:45` now generates each RFC 6238 vector with `totp.clone({ epoch: t * 1000, digits: 8, algorithm: 'sha1' })`.

## Resolution

- Updated the conformance-test header so HOTP truncation evidence and TOTP time-step evidence are distinct.
- Changed the RFC 6238 Appendix B test to use otplib `totp` directly instead of mutating HOTP options and manually deriving counters.
- Verified the focused TOTP and drift regression suites.

## Self-Review

- Task offset: this round improves test evidence for the TOTP atom; it does not change daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
