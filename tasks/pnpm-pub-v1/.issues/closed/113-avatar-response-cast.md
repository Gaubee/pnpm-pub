---
title: "Avatar profile response decoding assumed object shape"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The avatar cache path decoded the NPM user profile response with an unchecked object assertion before reading `avatar`.

## Impact
Chapter 4.3 defines cached avatars as a projection used for fast tray rendering. The NPM profile response is external source input and may be malformed, non-object, or have a non-string `avatar` field; promoting it with a TypeScript assertion can turn invalid projection data into an attempted image fetch.

## Evidence
- `src/daemon/avatar.ts:49` now reads the profile response through `readAvatarUrl`.
- `src/daemon/avatar.ts:84` keeps decoded JSON as `unknown` until `isRecord` proves object shape and `avatar` is a non-empty string.
- `test/unit/avatar.test.ts:48` verifies a non-string `avatar` field does not trigger an image fetch or cache write.
- `test/unit/avatar.test.ts:62` verifies a valid avatar URL still fetches image bytes and writes the avatar cache file.

## Resolution
- Replaced the unchecked avatar response assertion with a local unknown-safe decoder.
- Added focused unit coverage for invalid profile JSON and valid avatar cache writes.

## Self-Review
- Task offset: this round strengthens avatar response decoding only; it does not alter tray icon selection, cache directory layout, or profile persistence.
- Task residue: the remaining daemon and CLI runtime catch residues were later resolved by `tasks/pnpm-pub-v1/.issues/closed/114-daemon-runtime-error-cast.md` and `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
