---
title: Bare --profile consumes the next publish flag instead of rejecting it
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub publish --profile` currently accepts the next token as a profile value even when that token is another publish flag, instead of rejecting the malformed profile input.

## Impact

`spec/01.md` and `spec/07.md` require publish argument compatibility with native `pnpm publish` and a thin CLI that preserves argument source boundaries. A bare `--profile` is not part of native publish semantics; if the next token is a flag like `--dry-run`, the CLI should not reinterpret it as a profile name. Doing so mutates a bad input shape into a different source of action before publish intent validation.

## Evidence

- `src/cli/cli.ts` currently handles bare `--profile` by assigning the next argv token unconditionally.
- That means `pnpm-pub publish --profile --dry-run` can steal `--dry-run` as a profile override instead of rejecting the malformed `--profile` input.
- The parser already rejects a bare trailing `--profile` only when it is the final token, so the malformed mid-stream form slips through.

## Resolution

Treat bare `--profile` as requiring a non-flag value. The CLI now rejects `--profile` when the next token is missing or starts with `-`, before any daemon or publish flow starts.

Verification:

- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
