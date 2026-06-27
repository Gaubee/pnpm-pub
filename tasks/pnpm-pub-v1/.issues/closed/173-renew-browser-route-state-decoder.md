---
title: Renew browser route-state helper used an unchecked generic JSON cast
state: closed
github_issue_status: closed
label: test-coverage
resolution: fixed
---

## Summary

The browser-backed renew route regression decoded `agent-browser eval` output with `parseAgentBrowserJson<T>()` and promoted the parsed JSON to `RenewRouteState` through `as T`. The test was protecting a real projection boundary, but its own CLI-output boundary treated untrusted text as typed route-state facts.

## Impact

Chapter 6.2 depends on the rendered renew route keeping expired-token and credential re-apply projections separate. If the browser evidence helper accepts malformed output through an unchecked generic cast, the test can fail late or for the wrong reason, and the evidence boundary is weaker than the projection law it protects.

## Evidence

- `test/browser/renew-route-title.test.ts:131` now parses the final `agent-browser` output line into `unknown`.
- `test/browser/renew-route-title.test.ts:136` now promotes output into `RenewRouteState` only after checking object shape and string fields.
- `test/browser/renew-route-title.test.ts:155` now reports an invalid route-state payload explicitly instead of relying on a later assertion failure.
- `test/browser/renew-route-title.test.ts:191` now uses the guarded route-state decoder.
- `tasks/pnpm-pub-v1/TASKS.md` now keeps recent milestones in chronological order through Milestone 169.

## Resolution

Browser CLI output now follows the same source/projection rule as the runtime code:

```text
agent-browser stdout
    |
    v
unknown JSON value
    |
    v
RenewRouteState guard
    |
    v
route projection assertions
```

The helper still tolerates `agent-browser` returning either a JSON object or a JSON-encoded string, but the route-state object is no longer created by an unchecked generic cast.

## Self-Review

Task offset: this round stayed inside browser evidence and task-ledger projection hygiene. It did not alter renew route copy, daemon behavior, or the `agent-browser` CLI contract.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
