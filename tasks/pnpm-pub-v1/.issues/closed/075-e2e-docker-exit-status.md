---
title: "Dockerized E2E wrapper could mask test failures"
state: closed
github_issue_status: closed
label: "test-architecture"
---

## Summary

The Dockerized E2E script used a shell chain that always ran `docker compose down -v` after `pnpm test:e2e`. Because the final command was cleanup, a failing E2E test could be masked if cleanup succeeded.

## Impact

Chapter 10.3 defines the Verdaccio E2E lane as the full CLI/Daemon/IPC/WebUI/Registry proof. That lane must conserve the E2E test result as the script exit status while still cleaning up Docker resources.

## Evidence

- `spec/10.md:28` defines the Verdaccio E2E lane.
- `spec/10.md:39` requires checking that the CLI exits successfully and the package lands in the registry.
- `package.json:31` now delegates `pnpm test:e2e:docker` to `tsx scripts/run-e2e-docker.ts`.
- `scripts/run-e2e-docker.ts:21` starts Dockerized Verdaccio with `docker compose up -d --wait`.
- `scripts/run-e2e-docker.ts:24` runs `pnpm test:e2e`.
- `scripts/run-e2e-docker.ts:25` always tears Docker down after a successful startup.
- `scripts/run-e2e-docker.ts:26` returns the E2E test code when tests fail, otherwise the cleanup code.

## Resolution

- Replaced the shell-chain `test:e2e:docker` command with a typed runner.
- Preserved cleanup after successful Docker startup.
- Preserved the E2E failure exit status instead of letting cleanup mask it.

## Self-Review

- Task offset: this round fixes the Dockerized E2E wrapper contract; it does not make E2E part of the default `pnpm test` command.
- Task residue: this round type-checks the wrapper but does not start Dockerized Verdaccio in verification.
