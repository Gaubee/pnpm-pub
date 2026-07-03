---
title: "Publish CLI drift recovery ignored stdout-only OTP diagnostics"
state: closed
github_issue_status: closed
label: bug
milestone: 229
resolution: fixed
---

## Summary

The `pnpm publish` subprocess path only classified stderr when deciding whether a failed publish was an OTP failure that should trigger clock-drift recovery. In the publish interception e2e, the mock registry returned `403 OTP validation failed`, but the event resolved as a generic failed publish and never retried.

## Impact

Chapter 8.4 and Chapter 10.1.2 require clock-drift self-healing for publish writes. If pnpm renders the actionable OTP text outside stderr, the daemon loses the source signal and skips the recovery atom.

## Evidence

- `test/e2e/publish-intercept.test.ts` reproduced the failure in the `records clockDriftRecovered after an OTP-failure self-heal` scenario.
- The failed event result was `pnpm publish failed (exit 1)` and the drift registry saw only one PUT.
- `src/daemon/subprocess-runner.ts` previously accumulated only stderr for `outcomeToResult`.

## Resolution

`src/daemon/subprocess-runner.ts` now captures stdout as well as stderr, combines both streams for failure classification, and keeps success event output behavior unchanged. `test/unit/publisher.test.ts` covers stdout-only OTP diagnostics, and the publish interception e2e now selects its pending event by package name before confirmation.
