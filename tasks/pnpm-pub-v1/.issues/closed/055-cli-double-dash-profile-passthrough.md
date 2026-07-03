---
title: "CLI consumed publish --profile after double-dash passthrough boundary"
state: closed
github_issue_status: closed
label: "cli"
---

## Summary

`pnpm-pub` extracted `--profile` from the full raw fallback argument list, including arguments after the literal `--` separator. That meant a package-owned publish argument named `--profile` could be consumed as `pnpm-pub` metadata instead of being forwarded to the daemon.

## Impact

Chapter 7.1 defines fallback mode as muscle-memory-compatible `pnpm publish` passthrough. Treating `--profile` after `--` as a pnpm-pub override broke that boundary and could silently change the publish args sent to the daemon.

## Evidence

- `spec/07.md:13-18` requires unknown or default CLI input to degrade into publish arguments with 100% pnpm CLI compatibility.
- `src/cli/cli.ts:265-292` now stops profile extraction at the first literal `--` and preserves the remaining arguments.
- `src/cli/cli.ts:332-342` still strips a leading `publish` command before sending the final IPC publish args.
- `test/unit/cli-handshake.test.ts:147-169` proves `--profile=work` before `--` remains the daemon `profileOverride`, while `--profile` after `--` remains in `args`.

## Resolution

- Added a hard passthrough boundary at the literal `--` token in the raw CLI fallback parser.
- Preserved the existing pnpm-pub `--profile` override before that boundary.
- Added an IPC-frame regression so future parser changes cannot consume package-owned `--profile` args after `--`.

## Self-Review

- Task offset: this round changes only fallback CLI argument routing around the double-dash boundary.
- Task residue: no new residue found.
