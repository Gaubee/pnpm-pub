---
title: "E2E mock registry ingress used unchecked request casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish interception E2E mock registry still assumed incoming request chunks and `npm-otp` headers already had the shapes needed for evidence recording.

## Impact

Chapter 10.3 depends on the mock registry as the proof surface for parked publish intent, WebToken-confirmed release, and OTP clock-drift recovery. Request body and header evidence should be normalized at the protocol boundary instead of read through unchecked casts.

## Evidence

- `test/e2e/publish-intercept.test.ts` now reads mock registry request bodies through `readRequestBody`.
- The helper accepts only string, `Buffer`, or `Uint8Array` stream chunks before concatenating the body.
- `singleHeaderValue` normalizes `npm-otp` headers before registry hit evidence and drift-recovery evidence record them.
- The focused publish interception E2E still passes with the mock registry proof surface.

## Resolution

- Replaced unchecked request chunk and `npm-otp` header casts with local boundary helpers.
- Preserved the existing E2E publish, WebToken confirmation, bad-token rejection, and OTP drift recovery behavior.

## Self-Review

- Task offset: this round improves test protocol evidence hygiene; it does not change runtime CLI, daemon, WebUI, or registry behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
