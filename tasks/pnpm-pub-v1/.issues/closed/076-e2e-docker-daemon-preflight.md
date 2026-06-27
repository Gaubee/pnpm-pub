---
title: "Dockerized E2E wrapper lacked a daemon preflight"
state: closed
github_issue_status: closed
label: "test-architecture"
---

## Summary
The Dockerized E2E wrapper preserved test exit status, but it still went straight into Docker operations without naming the Docker daemon boundary. On a machine with Docker CLI installed but the daemon stopped, the wrapper should fail before Compose and explain the missing source of action.

## Impact
Chapter 10.3 defines the Verdaccio E2E lane as a Docker-backed full-loop proof. Docker is an external action source, so the wrapper should verify that source is available before creating or tearing down test infrastructure.

## Evidence
- `spec/10.md:33` requires Dockerized Verdaccio for the CI-style registry simulation.
- `package.json:31` delegates `pnpm test:e2e:docker` to `tsx scripts/run-e2e-docker.ts`.
- `scripts/run-e2e-docker.ts:21` now checks Docker daemon reachability with `docker info --format`.
- `scripts/run-e2e-docker.ts:23` now prints an explicit daemon-unreachable message before returning.
- `scripts/run-e2e-docker.ts:27` only starts Compose after the daemon preflight succeeds.
- Current environment evidence: `pnpm test:e2e:docker` exits with code 1 and reports `Docker daemon is not reachable. Start Docker and rerun ...`.

## Resolution
- Added an explicit Docker daemon preflight before `docker compose up`.
- Kept the wrapper from attempting Compose when Docker is not reachable.
- Verified the current unavailable-daemon path with `pnpm test:e2e:docker`.

## Self-Review
- Task offset: this round improves the Dockerized E2E wrapper boundary; it does not execute Verdaccio because the local Docker daemon is unavailable.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
