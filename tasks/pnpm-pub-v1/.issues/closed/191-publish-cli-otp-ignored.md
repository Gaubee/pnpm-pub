---
title: Publish CLI OTP argument is ignored
state: resolved
github_issue_status: closed
label: source-conservation
milestone: 187
resolution: fixed
---

## Summary

Native `pnpm publish --otp <code>` lets the caller provide the one-time password for a publish request, but the daemon currently ignores that CLI source fact.

## Impact

`spec/01.md` requires `pnpm-pub publish` to remain compatible with native `pnpm publish`, and `spec/07.md` defines the CLI as a thin publish proxy. Ignoring `--otp` means the registry-visible publish request uses a different OTP source than the command the user issued, blurring the source of action at the credential boundary.

## Evidence

- `src/daemon/scheduler.ts` parses `--registry`, `--tag`, and `--access`, but had no resolver for `--otp`.
- `src/daemon/npm-api.ts` always called `generateTotp(totpSecret)` for the publish request's `npm-otp` header.
- `PUBLISH_OPTIONS_WITH_VALUE` already treated `--otp` as a value-bearing option for positional parsing, so the missing behavior was forwarding, not recognition.

## Resolution

- Added scheduler-side `--otp <code>` and `--otp=<code>` resolution for publish requests.
- Passed explicit OTP through `publishPackage()` as a one-shot request credential while keeping stored TOTP as the default source.
- Prevented explicit OTP failures from silently retrying with a stored-secret drift OTP, preserving the CLI-supplied credential source.
- Added regressions for scheduler forwarding and registry request header behavior.
