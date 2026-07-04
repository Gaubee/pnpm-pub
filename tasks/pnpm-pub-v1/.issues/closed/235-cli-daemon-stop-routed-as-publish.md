---
title: "CLI daemon stop is routed as a publish intent"
state: closed
github_issue_status: closed
label: cli
milestone: 231
resolution: fixed
---

## Summary

`pnpm pub daemon stop` reached the fallback publish path as `["daemon", "stop"]` instead of the daemon lifecycle management path.

## Impact

The stop action is daemon-control ontology, not a publish event. Routing it through the publish pending wall required a configured profile, printed the GUI-confirmation prompt, and left the running daemon alive.

## Evidence

- `src/cli/cli.ts` only recognized top-level `start`, `status`, `stop`, and `version` before fallback routing.
- `pnpm pub daemon stop` printed `Waiting for GUI confirmation` and failed with `No profile configured. Add a profile via the tray GUI first.`
- The new regression in `test/unit/cli-stop.test.ts` proves `daemon stop` must send only `{ command: "stop" }`.

## Resolution

Reserved `daemon start|status|stop` as an explicit management namespace before fallback publish routing, documented the namespace in README and `spec/07.md`, rebuilt `dist/cli.js`, and verified the exact command stops the current daemon.

## Self-Review

- Task drift: the fix stayed at the CLI routing boundary; IPC stop authority and daemon shutdown behavior were not widened.
- Task residue: none after focused CLI tests, typecheck, build, issue validation, and exact `pnpm pub daemon stop`/`status` verification.
