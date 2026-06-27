---
title: "Clock-drift test used an unchecked OTP header cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The clock-drift recovery test cast the mock registry's `npm-otp` request header directly to `string | undefined`.

## Impact
Chapter 8.4 and Chapter 10.1.2 use this test as evidence that OTP drift recovery retries with a compensated one-time password. The evidence path should normalize Node's real header shape (`string | string[] | undefined`) instead of relying on a cast.

## Evidence
- `test/unit/drift.test.ts` now reads the header through `firstHeaderValue`.
- The helper preserves single string headers and chooses the first value from multi-value headers.
- `pnpm exec vitest run test/unit/drift.test.ts` verifies drift retry and expired-token classification still pass.

## Resolution
- Replaced the unchecked header cast with explicit header normalization.
- Preserved the existing mock registry behavior and OTP attempt recording.

## Self-Review
- Task offset: this round strengthens the verification surface for clock-drift recovery; it does not change production TOTP generation, registry classification, or retry semantics.
- Task residue: the command-runner stream chunk cast and test-only package metadata cast were later resolved by `tasks/pnpm-pub-v1/.issues/closed/105-packer-output-chunk-cast.md` and `tasks/pnpm-pub-v1/.issues/closed/106-proactive-events-mock-metadata-cast.md`; the broader registry decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
