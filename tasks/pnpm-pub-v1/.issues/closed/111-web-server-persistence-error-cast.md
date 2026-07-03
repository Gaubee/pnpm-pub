---
title: "WebServer persistence failure paths assumed Error throws"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The WebServer projected add-profile, renew, and import persistence failures through unchecked `Error` assertions.

## Impact

Chapters 4.1 and 8.1/8.2 define profiles.json and OS keychain writes as durable credential/profile boundaries. Failures at that boundary are source input from storage, keychain, or adapters and are not guaranteed to be `Error` instances; asserting them as `Error` can erase the actual failure text returned to the WebUI.

## Evidence

- `src/daemon/web-server.ts:409` now projects add-profile persistence failures through `errorToMessage`.
- `src/daemon/web-server.ts:461` now projects renew persistence failures through the same helper.
- `src/daemon/web-server.ts:537` now projects import persistence failures through the same helper.
- `src/daemon/web-server.ts:659` preserves normal `Error.message` behavior while stringifying non-`Error` thrown values.
- `test/unit/web-server-renew.test.ts:162` verifies non-`Error` add-profile persistence failures preserve their source text.
- `test/unit/web-server-renew.test.ts:191` verifies non-`Error` renew persistence failures preserve their source text while rollback still restores credentials.
- `test/unit/web-server-renew.test.ts:382` verifies non-`Error` import persistence failures preserve their source text while rollback still clears imported credentials.

## Resolution

- Replaced all three WebServer persistence-boundary `Error` assertions with one local `unknown`-safe projection helper.
- Added focused HTTP regression coverage for non-`Error` persistence failures in add-profile, renew, and import flows.

## Self-Review

- Task offset: this round strengthens WebServer failure projection only; it does not alter credential persistence ordering, rollback semantics, request parsing, encryption, or WebSocket behavior.
- Task residue: the broader runtime catch paths named here were later resolved by `tasks/pnpm-pub-v1/.issues/closed/112-scheduler-write-error-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/114-daemon-runtime-error-cast.md`, and `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
