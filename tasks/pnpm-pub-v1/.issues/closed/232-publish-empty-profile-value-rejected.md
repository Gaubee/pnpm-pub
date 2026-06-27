---
title: Empty --profile= input bypasses profile validation
state: resolved
github_issue_status: closed
label: parity
milestone: pnpm-pub-v1
resolution: fixed
---

## Summary

`pnpm-pub start --profile=` and `pnpm-pub --profile= --dry-run` were still treating an empty profile value as acceptable input instead of rejecting it as a malformed CLI boundary.

## Impact

`spec/01.md` and `spec/07.md` require the CLI to preserve argument-source boundaries and reject malformed profile input before it reaches daemon IPC or publish flow. An empty `--profile=` token is not a real profile name. Accepting it turns a bad source of action into a silent default path, which can boot the daemon or proceed with publish intent under the wrong profile boundary.

## Evidence

- `src/cli/cli.ts` accepted `parsed.profile === ''` from yargs and passed it into `runStart()` without validation.
- `src/cli/cli.ts` also parsed raw fallback args with `--profile=(.+)`, which skipped `--profile=` entirely and let the empty token fall through to publish handling.
- Repro shape: `pnpm-pub start --profile=` and `pnpm-pub --profile= --dry-run` both reached the CLI boundary with an empty profile string.

## Resolution

Reject empty profile values in both the explicit `start` path and the fallback publish parser. The CLI now fails locally with the existing profile-value error before any daemon IPC or publish flow starts.

Verification:

- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/cli-start.test.ts`
