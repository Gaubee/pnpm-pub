---
title: "E2E packument fetch trusted registry JSON through a cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish interception E2E `fetchPackument` helper cast registry JSON directly to a packument shape.

## Impact

Chapter 10.3 uses registry packument reads as proof that the package was not published before confirmation and did land after confirmation. That evidence should be a checked projection over registry JSON, not an unchecked assertion.

## Evidence

- `test/e2e/publish-intercept.test.ts` now defines `RegistryPackument` and an `isRegistryPackument` guard.
- `fetchPackument` parses JSON into `unknown` and returns a packument only after validating the `versions` shape.
- The focused publish interception E2E still proves parked publish intent, WebToken-confirmed publish, bad-token rejection, and clock-drift recovery.

## Resolution

- Replaced the direct packument JSON cast with a small shape guard.
- Preserved the E2E registry assertions for before/after publish state.

## Self-Review

- Task offset: this round improves E2E registry evidence hygiene; it does not change runtime CLI, daemon, WebUI, or registry behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
