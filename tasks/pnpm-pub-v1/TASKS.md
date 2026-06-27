# pnpm-pub v1 Tasks

## Milestone 1 — review-fix round

Status: complete

### Delivered
- Fixed WebSocket extended-length framing.
- Restored tray startup in the release daemon entrypoint.
- Reworked `/api/renew` so it reuses the stored TOTP secret and preserves it on manual-token renew.
- Aligned the root Vite dependency with the Vitest config so `pnpm typecheck` runs cleanly.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/main-entry.test.ts test/unit/web-server-renew.test.ts`
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`

### Residuals
- none

## Milestone 2 — renew recovery round

Status: complete

### Delivered
- Made `/api/renew` transactional so a failed persist restores the previous token, TOTP secret, and in-memory credential pool.
- Allowed renew to accept a supplied TOTP secret when keychain state is missing.
- Exposed the TOTP recovery field in the renew WebUI for both silent and manual recovery modes.
- Added regression coverage for rollback, manual-token recovery, and password-based recovery with a supplied TOTP secret.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/main-entry.test.ts test/unit/web-server-renew.test.ts`
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`

### Residuals
- `tasks/pnpm-pub-v1/.issues/007-develop-tasks-dot-issues-validation.md` tracks that the bundled develop-tasks validator does not discover the user-requested `.issues/` layout; issue files were validated manually against the skill rules instead.

## Milestone 3 — task-loop validation round

Status: complete

### Delivered
- Added `tasks/pnpm-pub-v1/scripts/issues.ts` as the task-local issue validator/archive helper for the required `.issues/` ledger.
- Closed and archived the workflow blocker at `tasks/pnpm-pub-v1/.issues/closed/007-develop-tasks-dot-issues-validation.md`.
- Kept the durable fix inside the task artifact boundary instead of relying on ignored `.agents/` local agent configuration.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 archive-closed`

### Residuals
- none

## Milestone 4 — proactive event execution round

Status: complete

### Delivered
- Added scheduler-owned proactive event creation so WebUI actions mount into the same executable pending wall as CLI publish intents.
- Added typed payload normalization for proactive publish, setup-oidc, placeholder, and token-refresh events; unsupported import/export event creation is rejected at the scheduler boundary.
- Routed the WebServer `create-event` handler through the scheduler instead of writing pending store events directly.
- Added regression coverage for a WebUI-style OIDC event confirming through the pending wall and for invalid payload rejection.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/main-entry.test.ts test/unit/web-server-renew.test.ts test/unit/proactive-events.test.ts`
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`

### Residuals
- none

## Milestone 5 — OIDC workflow source boundary round

Status: complete

### Delivered
- Removed the `NODE_AUTH_TOKEN` / `NPM_TOKEN` secret dependency from the generated Trusted Publish workflow.
- Strengthened the proactive OIDC regression so generated workflows must contain `id-token: write` and `npm publish --provenance` while excluding long-lived token secret hooks.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/009-oidc-workflow-uses-npm-token-secret.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `rg -n "NODE_AUTH_TOKEN|secrets\\.NPM_TOKEN|NPM_TOKEN" src/daemon/oidc-template.ts test/unit/proactive-events.test.ts`

### Residuals
- none

## Milestone 6 — placeholder package ontology round

Status: complete

### Delivered
- Changed `create-placeholder` payloads from fake filesystem publish requests into package-identity events.
- Added a scheduler-owned placeholder execution path that generates a minimal temporary `0.0.0` package, packs it, publishes it, and removes the temporary source.
- Removed stale placeholder coupling from the regular `runPublish()` path.
- Updated the WebUI protocol mirror and Events projection so placeholders display as generated artifacts rather than real local paths.
- Added regression coverage for confirming a placeholder event into a generated `0.0.0` publish.

### Verification
- `pnpm typecheck`
- `pnpm --filter ./webui run check`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `rg -n "create-placeholder|CreatePlaceholderContext|path: '/'|path: \\\"/\\\"|Both 'publish'" src webui/src test -S`

### Residuals
- none

## Milestone 7 — token refresh action-required round

Status: complete

### Delivered
- Added `action-required` to the shared daemon/WebUI event status ontology.
- Changed `refresh-token` confirmation from false `success` into an action-required Event result that tells the user credential re-apply is needed.
- Updated the Events card projection so refresh-token confirmation has a specific label and action-required events surface the renew flow.
- Added regression coverage proving refresh-token confirmation does not perform publish/OIDC writes and resolves to `action-required`.

### Verification
- `pnpm typecheck`
- `pnpm --filter ./webui run check`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `rg -n "Token refresh acknowledged|Token refresh requested|action-required|refresh-token|Confirm Token Refresh|Credential input required" src webui/src test -S`

### Residuals
- none

## Milestone 8 — export keychain source round

Status: complete

### Delivered
- Changed `/api/export` to resolve credentials from the in-memory pool first and OS keychain second.
- Rehydrates the memory credential pool when export recovers a complete keychain-backed credential pair.
- Preserved the existing encrypted bundle format and skipped-profile reporting for profiles missing a complete credential pair in both sources.
- Added regression coverage for exporting a configured profile whose credentials are only available through keychain.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm exec vitest run test/unit/crypto.test.ts test/unit/keychain.test.ts test/unit/web-server-renew.test.ts`
- `rg -n "getToken\\(|getTotpSecret\\(|skipped|No credentials loaded to export|/api/export|exports profile credentials" src/daemon/web-server.ts test/unit/web-server-renew.test.ts -S`

### Residuals
- none

## Milestone 9 — web-server JSON boundary round

Status: complete

### Delivered
- Replaced the `WebServer` JSON API boundary's `any` handling with typed object decoding and field-level validators.
- Restored `DELETE /api/profiles` body handling so profile removal receives its `username` source field.
- Added a runtime `BackupBundle` guard before secret import and mapped malformed payloads to `400` client errors.
- Added regression coverage for the DELETE body path and invalid import bundle rejection.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`

### Residuals
- none

## Milestone 10 — TOTP drift correction round

Status: complete

### Delivered
- Made the offset-aware TOTP helper actually honor the supplied epoch shift.
- Routed drift recovery through the offset-aware helper instead of a duplicate local-clock path.
- Added regression coverage proving the offset helper matches the code generated at the adjusted epoch.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/totp.test.ts`

### Residuals
- none

## Milestone 11 — memfs adapter type-safety round

Status: complete

### Delivered
- Replaced the test memfs adapter's double cast with the upstream `memfs` `IFs` type.
- Kept the virtual filesystem harness aligned with the package's real typed interface.
- Verified the change with root typecheck and focused ws/totp unit tests.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/totp.test.ts test/unit/ws.test.ts`

### Residuals
- none

## Milestone 12 — TOTP epoch clone round

Status: complete

### Delivered
- Replaced the runtime TOTP Date monkey-patch with a preset-backed epoch clone.
- Kept offset-aware generation pure while preserving the drift-recovery contract.
- Moved deterministic time control into the unit test harness only.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/totp.test.ts test/unit/drift.test.ts`

### Residuals
- none

## Milestone 13 — WebSocket socket contract round

Status: complete

### Delivered
- Replaced the WebSocket upgrade path's socket cast with a shared minimal socket contract.
- Removed the test harness double cast and aligned the fake socket with the same contract.
- Verified the boundary with root typecheck and focused ws/totp/drift tests.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/totp.test.ts test/unit/drift.test.ts`

### Residuals
- none

## Milestone 14 — opentray browser bridge ambient round

Status: complete

### Delivered
- Added an app-level ambient declaration for the opentray browser bridge.
- Removed the navigator cast from the drag-region component and used the typed browser surface directly.
- Verified the boundary with root typecheck and WebUI `svelte-check`.

### Verification
- `pnpm typecheck`
- `pnpm --filter ./webui run check`

### Residuals
- none

## Milestone 15 — workspace scanner worktree isolation round

Status: complete

### Delivered
- Added a focused regression proving the workspace scanner does not report packages from a fake Git worktree admin tree under `.git/worktrees/...`.
- Kept the scanner implementation unchanged because the existing `.git` exclusion already enforced the spec law.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/019-workspace-scanner-lacks-worktree-isolation-regression.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/workspace.test.ts`

### Residuals
- none

## Milestone 16 — profile switch workspace projection round

Status: complete

### Delivered
- Updated the WebSocket `select-profile` flow to re-broadcast the current workspace snapshot after switching identities.
- Kept the projection law at the daemon boundary instead of introducing a separate workspace source.
- Added and then closed the regression note at `tasks/pnpm-pub-v1/.issues/closed/020-profile-switch-does-not-refresh-workspace-projection.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`

### Residuals
- none

## Milestone 17 — profile override regression round

Status: complete

### Delivered
- Added a CLI regression proving `--profile=work` survives transport into the publish intent frame.
- Added a scheduler regression proving pending publish events retain `profileOverride` for confirm-time identity selection.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/021-profile-override-lacks-end-to-end-regression.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/proactive-events.test.ts`

### Residuals
- none

## Milestone 18 — start profile IPC regression round

Status: complete

### Delivered
- Added an isolated IPC-server regression proving `start --profile=work` reaches `onStart` and updates the daemon default profile.
- Kept the proof at the IPC authority boundary instead of inventing a broader status-frame contract.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/022-start-profile-lacks-ipc-regression.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/ipc-server.test.ts`

### Residuals
- none

## Milestone 19 — CLI stop regression round

Status: complete

### Delivered
- Added a mocked-net regression proving `pnpm-pub stop` sends the stop frame and prints the shutdown acknowledgement.
- Kept the proof isolated from filesystem socket timing so it stays stable under the current harness.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/024-cli-stop-lacks-regression.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/cli-stop.test.ts`

### Residuals
- none

## Milestone 20 — CLI management regression closeout

Status: complete

### Delivered
- Closed and archived the stale CLI management gap note at `tasks/pnpm-pub-v1/.issues/closed/023-cli-status-stop-lack-regression.md`.
- Kept the task ledger aligned with the now-covered `status` and `stop` CLI proofs.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 21 — Workspaces OIDC repo source round

Status: complete

### Delivered
- Replaced the Workspaces OIDC placeholder repo slug with repository metadata sourced from scanned package.json records.
- Threaded repository identity through the daemon workspace scan, event creation, and UI projections instead of manufacturing it in the view layer.
- Kept OIDC actions disabled when repository metadata is absent so the UI no longer emits fake source data.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/025-workspaces-oidc-placeholder-repo.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts test/unit/proactive-events.test.ts test/unit/cli-handshake.test.ts test/unit/cli-stop.test.ts test/unit/ipc-server.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 22 — Events new-action source round

Status: complete

### Delivered
- Replaced the Events "New Action" menu's hardcoded demo payloads with controlled inputs for placeholder and OIDC actions.
- Kept the refresh-token quick action profile-derived and removed the last runtime path that manufactured fake action identity.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/026-events-new-action-placeholder-source.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 23 — Dev runner demo seed removal round

Status: complete

### Delivered
- Removed the dev runner's hardcoded demo pending event so the Events timeline is no longer fabricated at process startup.
- Kept the dev runner itself minimal while stopping the runner from manufacturing runtime event truth.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/027-dev-runner-demo-event-seed.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 24 — Dev runner mock profile removal round

Status: complete

### Delivered
- Removed the dev runner's automatic mock profile and throwaway credentials so it no longer pre-populates synthetic runtime identity.
- Updated the dev startup banner to instruct users to add a profile in the UI instead of implying a seeded identity exists.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/028-dev-runner-mock-profile-seed.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 25 — Workspace repository normalization round

Status: complete

### Delivered
- Broadened workspace repository normalization so common `git+https` GitHub repository strings still surface a repo slug.
- Kept the source-backed OIDC path intact by ensuring scanned package metadata preserves repository identity across common package.json encodings.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/029-workspace-repository-normalization-gap.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 26 — Dev runner banner alignment round

Status: complete

### Delivered
- Updated the dev runner banner to match the post-removal runtime behavior by instructing users to add a profile in the UI before publishing.
- Kept the startup text aligned with the no-seeded-identity dev flow instead of implying an immediately usable profile.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/030-dev-runner-banner-misleading-publish-instruction.md`.

### Verification
- `pnpm exec vitest run test/unit/main-entry.test.ts test/unit/workspace.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 27 — Dev runner comment alignment round

Status: complete

### Delivered
- Updated the dev runner file header to stop describing a seeded mock profile after that bootstrap had been removed.
- Kept the source comment aligned with the actual no-seeded-profile dev flow and the already-corrected banner text.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/031-dev-runner-comment-stale-mock-profile.md`.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 28 — TASKS ledger wording correction round

Status: complete

### Delivered
- Corrected the stale Milestone 23 wording so it no longer claims the dev runner kept a mock profile bootstrap intact after that bootstrap was removed.
- Kept the task ledger aligned with the actual evolution of the dev runner and its runtime state.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/032-task-ledger-stale-dev-runner-note.md`.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 29 — spec/07 socket path normalization round

Status: complete

### Delivered
- Normalized `spec/07.md` to use `~/.pnpm-pub/run/pnpm-pub.sock`, matching the IPC law already stated in `spec/03.md` and implemented in `src/shared/paths.ts`.
- Removed the last spec-level contradiction around the Unix socket path.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/033-spec-07-stale-socket-path.md`.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 30 — spec/03 Unix socket platform wording round

Status: complete

### Delivered
- Normalized `spec/03.md` so the Unix Domain Socket law applies to `macOS / Linux`, matching `src/shared/paths.ts` and the IPC implementation.
- Removed the last spec-level mismatch around the Unix socket platform wording.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/034-spec-03-macos-only-socket-wording.md`.

### Verification
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals
- none

## Milestone 31 — dev banner backtick syntax repair round

Status: complete

### Delivered
- Removed the raw backticks from the dev runner banner so the template literal compiles again.
- Kept the runtime banner aligned with the no-seeded-profile dev flow without breaking the syntax envelope.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/035-dev-banner-backtick-string-break.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/workspace.test.ts test/unit/cli-handshake.test.ts test/unit/main-entry.test.ts`

### Residuals
- none

## Milestone 32 — event card placeholder projection type round

Status: complete

### Delivered
- Aligned the placeholder event projection with the shared `PublishTarget` contract so `repository` remains available in the Events card.
- Kept the Workspaces/OIDC projection on one shared target law instead of letting Svelte infer a narrower anonymous shape.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/036-event-card-placeholder-target-type-drift.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts test/unit/web-server-renew.test.ts`

### Residuals
- none

## Milestone 33 — spec/03 keychain proxy law alignment round

Status: complete

### Delivered
- Replaced the stale Rust N-API credential-storage wording in `spec/03.md` with the active `@github/keytar` native proxy law.
- Kept the security chapter aligned with `spec/02.md` and `src/daemon/keychain.ts` instead of preserving a dual Rust/Keytar story.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/037-spec-03-stale-rust-keychain-law.md`.

### Verification
- `rg -n "Rust N-API|napi-rs|Rust.*代理" spec -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- none

## Milestone 34 — daemon socket platform wording alignment round

Status: complete

### Delivered
- Updated `spec/05.md` so daemon single-instance socket binding uses the same `macOS / Linux` Unix socket platform law as `spec/03.md`.
- Updated the shared `runDir()` comment to describe the Unix socket directory for macOS/Linux instead of macOS only.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/038-daemon-socket-platform-wording-drift.md`.

### Verification
- `rg -n "Unix Domain Socket \\(macOS\\)|pnpm-pub\\.sock \\(macOS\\)|macOS-only|macOS only" spec src -S`
- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/ipc-server.test.ts`
- `git diff --check`

### Residuals
- none

## Milestone 35 — WebToken entropy wording alignment round

Status: complete

### Delivered
- Corrected `spec/05.md` so WebToken generation is described as 256-bit random material rendered as 64 hexadecimal characters.
- Kept the core service chapter aligned with `spec/03.md` and `src/daemon/index.ts` instead of understating the UI authorization boundary as 64-bit.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/039-spec-05-webtoken-bit-length-drift.md`.

### Verification
- `rg -n '64 位的强随机|64-bit WebToken|64 位.*WebToken' spec src test -S`
- `pnpm typecheck`
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `git diff --check`

### Residuals
- none

## Milestone 36 — CLI CWD workspace auto-collection round

Status: complete

### Delivered
- Added scheduler-side workspace auto-collection for CLI publish CWDs, using the existing root/risk workspace law.
- Persisted only safe rooted workspaces through `store.addWorkspace()` and reported risky auto-collect paths to CLI stderr without writing them to disk.
- Added a regression proving a package CWD inside a monorepo records the workspace root while the pending publish event keeps the original CWD.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/040-cli-cwd-workspace-auto-collect-gap.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts test/unit/store.test.ts`
- `pnpm typecheck`
- `git diff --check`

### Residuals
- none

## Milestone 37 — Keytar fat-package layout round

Status: complete

### Delivered
- Changed the Keytar copy plugin to preserve Keytar's own package layout under `dist/prebuilds/keytar/`.
- Added a copied `package.json` CommonJS boundary so the Keytar shim is not reinterpreted by the root ESM package.
- Removed the runtime direct native-binary fallback branch from `src/daemon/keychain.ts`, leaving the copied package shim as the production atom and installed `@github/keytar` as the dev fallback.
- Updated `spec/09.md` to describe the copied shim, preserved prebuild layout, and CommonJS boundary.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/041-keytar-fat-package-layout-drift.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/keychain.test.ts`
- `pnpm run build:core`
- `find dist/prebuilds/keytar -maxdepth 4 -type f | sort`
- `node -e "const k=require('./dist/prebuilds/keytar/lib/keytar.js'); console.log(Object.keys(k).sort().join(','))"`
- `rg -n "legacy / explicit|Direct native binary|resolveBinaryPath|keytarPath|require\\(keytarPath\\)|<plat>-<arch>\\.node|platform-arch\\.node" spec src tsdown.config.ts -S`
- `git diff --check`

### Residuals
- none

## Milestone 38 — Backup import preview contract round

Status: complete

### Delivered
- Added a WebUI-side `BackupBundle` type guard for pasted backup JSON.
- Routed both import preview and import submission through the same bundle-shape validation instead of casting raw parsed JSON.
- Kept the WebUI projection aligned with the server-side `/api/import` bundle contract.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/042-backup-page-import-preview-casts-json.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm exec vitest run test/unit/crypto.test.ts test/unit/web-server-renew.test.ts`
- `rg -n "JSON\\.parse\\(importBundle\\)|profiles\\?: string\\[\\]" webui/src/routes/backup/+page.svelte -S`
- `git diff --check`

### Residuals
- none

## Milestone 39 — Onboarding token body burnability round

Status: complete

### Delivered
- Corrected `spec/08.md` so the onboarding auto-token sequence uses `POST /-/npm/v1/tokens`.
- Changed `applyToken()` to send the sensitive token request body as a `Buffer` and burn it after the registry call.
- Added a focused regression proving the token application boundary uses `POST` and zeroes the captured request body buffer.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/043-apply-token-request-body-burnability.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/npm-api.test.ts test/unit/web-server-renew.test.ts`
- `rg -n "PUT /-/npm/v1/tokens|调用 API: PUT" spec src test -S`
- `rg -n "body: JSON\\.stringify" src/daemon/npm-api.ts test/unit/npm-api.test.ts -S`
- `git diff --check`

### Residuals
- `src/daemon/npm-api.ts:208` still uses `body: JSON.stringify(buildBody())` for package publish metadata, which is a separate npm `PUT` endpoint and not the Chapter 8 token onboarding password body.

## Milestone 40 — Events status ontology spec alignment round

Status: complete

### Delivered
- Updated `spec/06.md` to describe the full Event status ontology: pending, success, failed, rejected, expired, and action-required.
- Preserved `Expired` and `Action Required` as credential-renewal sources instead of collapsing them into failed-event projections.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/044-spec-06-event-status-ontology-drift.md`.

### Verification
- `rg -n "包含三种状态" spec/06.md -S`
- `rg -n "EventStatus|action-required|expired|rejected" spec/06.md src/shared/index.ts src/daemon/scheduler.ts webui/src/lib/components/event-card.svelte -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- none

## Milestone 41 — OIDC overwrite guard source-order round

Status: complete

### Delivered
- Moved the `.github/workflows/publish.yml` overwrite guard ahead of the registry-side `configureOidc()` call.
- Preserved the Chapter 1 `--force` law by failing locally before any external OIDC side effect when a workflow already exists.
- Added a regression proving an existing workflow is not overwritten and `configureOidc()` is not called without `force`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/045-oidc-workflow-guard-after-registry-action.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The OIDC workflow write-failure result residue was later resolved by issue 052.

## Milestone 42 — WebServer JSON body burnability round

Status: complete

### Delivered
- Burned raw HTTP JSON request buffers in `WebServer.readJson()` after parsing.
- Reused the shared `burnBuffer()` primitive so password-bearing REST requests follow the same burn-after-read law as NPM token application.
- Added a regression proving a password-bearing `/api/renew` request triggers `Buffer.fill(0)`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/046-web-server-json-body-buffer-not-burned.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Endpoint handlers still receive JavaScript strings after JSON parsing. The raw transport buffers are now burned; deeper string lifetime is a JS runtime limitation.

## Milestone 43 — Backup crypto password-buffer derivation round

Status: complete

### Delivered
- Changed `deriveKey()` to derive from a caller-owned password `Buffer` instead of allocating its own hidden password buffer from a string.
- Routed backup export/import through the burnable password buffer and burned password, plaintext, and key buffers in `finally`.
- Reused the shared `burnBuffer()` primitive across backup crypto.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/047-crypto-derive-key-ignored-burnable-password-buffer.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/crypto.test.ts test/unit/web-server-renew.test.ts`
- `rg -n "deriveKey\\('[^']|deriveKey\\(password: string|pbkdf2Sync\\(Buffer\\.from\\(password|pwBuf\\.fill\\(0\\)|key\\.fill\\(0\\)" src test -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Public crypto functions still accept password strings from the WebServer boundary. The first crypto-owned password buffer is now the actual PBKDF2 source and is burned.

## Milestone 44 — Stale daemon onboarding export removal round

Status: complete

### Delivered
- Removed the stale `src/daemon/index.ts` `addProfile()` export that bypassed `profiles.json`, rollback, manual-token fallback, and in-memory credential-pool updates.
- Removed the now-unused shared `AddProfilePayload` and `AddProfileResult` types that only described the stale onboarding path.
- Preserved the active `/api/add-profile` WebServer/store boundary as the sole onboarding action source.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/048-daemon-index-stale-add-profile-onboarding.md`.

### Verification
- `pnpm typecheck`
- `rg -n "addProfile\\(|AddProfilePayload|AddProfileResult" src test webui/src -S`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts test/unit/main-entry.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- no library export is declared in `package.json`; if one is added later, onboarding should be exposed through a store-backed service contract rather than daemon lifecycle exports.

## Milestone 45 — Profile extension type-safety spec round

Status: complete

### Delivered
- Replaced the remaining `Record<string, any>` in Chapter 4's public `PnpmPubConfig` schema with `Record<string, unknown>`.
- Aligned the spec-level `ciPreferences` extension boundary with the daemon shared type and WebUI protocol mirror.
- Preserved `ciPreferences` as extension data while requiring explicit narrowing before use.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/049-spec-04-profile-ci-preferences-any.md`.

### Verification
- `rg -n "ciPreferences|Record<string, any>|Record<string, unknown>" spec/04.md src/shared/index.ts webui/src/lib/types.ts -S`
- `rg -n "Record<string, any>|\\bany\\b|as any|ts-nocheck" src webui/src test spec -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- comment text still contains plain English uses of the word "any"; no type-level `any`, `as any`, or `ts-nocheck` remains in source or spec.

## Milestone 46 — Package version release-truth round

Status: complete

### Delivered
- Added a shared `readPackageVersion()` boundary that resolves the real `pnpm-pub` `package.json` and reads its `version`.
- Routed CLI version handshakes through the package-version reader instead of a duplicated runtime constant.
- Routed the packaged daemon entrypoint through the same package-version reader before `bootDaemon()`.
- Added/updated focused assertions for CLI handshake and daemon entry version behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/050-cli-daemon-version-hardcoded.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/main-entry.test.ts`
- `rg -n "const CLI_VERSION = '0\\.1\\.0'|pkg = \\{ version: '0\\.1\\.0' \\}" src -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The test-fixture version literal residue was later resolved by issue 171.

## Milestone 47 — Backup import rollback round

Status: complete

### Delivered
- Made `/api/import` transactional at the profile boundary: imported keychain credentials are rolled back if `profiles.json` persistence fails.
- Cleared imported in-memory credentials during rollback so no orphan imported identity remains visible to runtime code.
- Added a focused regression for failed import persistence after token/TOTP writes.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/051-import-profile-persistence-rollback.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `rg -n "rollbackImportedProfiles|Failed to import profile|deleteToken\\(|deleteTotpSecret\\(" src/daemon/web-server.ts test/unit/web-server-renew.test.ts -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- rollback is intentionally scoped to profiles imported in the current request; unrelated pre-existing profiles are not deleted.

## Milestone 48 — OIDC workflow write result round

Status: complete

### Delivered
- Changed OIDC setup so a failed `.github/workflows/publish.yml` write resolves the Event as `failed` and exits non-zero.
- Preserved the existing local overwrite guard before the registry-side `configureOidc()` action.
- Added a focused regression for successful registry configuration followed by local workflow write failure.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/052-oidc-workflow-write-failure-false-success.md`.

### Verification
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `rg -n "could not write workflow|resolveEvent\\(event\\.id, 'failed'|workflow write fails" src/daemon/scheduler.ts test/unit/proactive-events.test.ts -S`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- registry-side OIDC may already be configured when the local workflow write fails. The Event now reports that partial external side effect as a failed local action instead of success.

## Milestone 49 — Event override avatar projection round

Status: complete

### Delivered
- Updated the Events card effective-identity pill to resolve the active/override profile from the daemon profile snapshot.
- Rendered the profile `avatarUrl` in the context-override identity marker while preserving initials as fallback.
- Kept avatar data as profile projection state instead of duplicating it into Event ontology.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/053-event-card-override-avatar-projection.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- none

## Milestone 50 — Workspace glob gitignore exclusion round

Status: complete

### Delivered
- Added a prefix-aware ignored-path predicate to the workspace scanner.
- Applied `.gitignore` filtering to simple `pnpm-workspace.yaml` package-glob candidates before package extraction.
- Applied the same exclusion to scoped package candidates under workspace globs.
- Added a focused regression proving `packages/generated` ignored by root `.gitignore` does not surface through a `packages/*` fast path.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/054-workspace-glob-gitignore-gap.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The simple path-entry residue was later tightened by issue 172; wildcard directory support was later tightened by issue 116.

## Milestone 51 — CLI double-dash passthrough round

Status: complete

### Delivered
- Stopped the pnpm-pub fallback parser from extracting `--profile` after the literal `--` passthrough boundary.
- Preserved leading pnpm-pub `--profile` as the daemon `profileOverride`.
- Added an IPC-frame regression proving package-owned `--profile` after `--` remains in publish args.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/055-cli-double-dash-profile-passthrough.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- none

## Milestone 52 — WebUI secret input residue round

Status: complete

### Delivered
- Cleared add-profile TOTP secret and manual token state after successful profile creation.
- Cleared renew manual token and recovery TOTP secret state after successful renewal.
- Cleared backup export/import protection password state after daemon responses.
- Kept durable credential ownership in daemon/keychain instead of adding UI-side persistence.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/056-webui-secret-input-residue.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- JavaScript strings may still exist transiently during request construction and browser GC; daemon-side buffer burning remains the stronger boundary.

## Milestone 53 — Profile source conservation round

Status: complete

### Delivered
- Rejected unknown profile names at the `DaemonStore.setDefault()` source boundary instead of allowing `profiles.json` to point at a non-existent identity.
- Added a WebSocket `select-profile` error path so stale or malformed profile-switch messages do not rebroadcast a false active identity.
- Guarded scheduler proactive Event creation so GUI actions cannot mount orphan pending Events without a configured profile atom.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/057-unknown-profile-event-source.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts test/unit/proactive-events.test.ts test/unit/web-server-renew.test.ts`
- `pnpm typecheck`

### Residuals
- Existing in-memory Events from earlier buggy runtime sessions are not migrated; the current event log is process-local.

## Milestone 54 — WebToken log redaction round

Status: complete

### Delivered
- Split the WebUI URL projection into an authority-bearing launch URL and a log-safe redacted URL.
- Changed daemon startup logging so `~/.pnpm-pub/logs/daemon.log` records `#token=<redacted>` instead of the lifecycle WebToken.
- Added a daemon startup regression proving the real `webToken` does not appear in the log file.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/058-webtoken-logged-to-daemon-log.md`.

### Verification
- `pnpm exec vitest run test/unit/daemon-logging.test.ts test/unit/main-entry.test.ts`
- `pnpm typecheck`

### Residuals
- `src/daemon/dev.ts` still prints the full URL to the interactive dev console as the explicit developer launch surface.

## Milestone 55 — IPC start-profile authority round

Status: complete

### Delivered
- Changed the IPC `onStart` contract to return whether the requested profile was actually applied.
- Rejected `start --profile=<unknown>` with an `exit` frame instead of reporting a false active daemon status.
- Kept valid `start --profile=work` behavior source-backed through `DaemonStore.setDefault()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/059-start-profile-false-active.md`.

### Verification
- `pnpm exec vitest run test/unit/ipc-server.test.ts test/unit/main-entry.test.ts`
- `pnpm typecheck`

### Residuals
- CLI display of the rejection still uses the existing IPC exit-frame handling path.

## Milestone 56 — CLI patch-version handshake round

Status: complete

### Delivered
- Changed the daemon IPC version handshake from major/minor comparison to major/minor/patch comparison.
- Ensured a newer patch CLI such as `0.1.1` against daemon `0.1.0` emits `daemon-outdated` and invokes daemon stop.
- Added a regression proving older CLI versions remain silent and do not stop the daemon.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/060-cli-patch-version-handshake.md`.

### Verification
- `pnpm exec vitest run test/unit/ipc-server.test.ts test/unit/cli-handshake.test.ts`
- `pnpm typecheck`

### Residuals
- Prerelease ordering was later tightened by issue 177; production handshakes use release package versions.

## Milestone 57 — CLI start profile verdict round

Status: complete

### Delivered
- Changed `pnpm-pub start --profile=<name>` to wait for the daemon IPC verdict instead of printing success immediately after sending the management frame.
- Forwarded daemon `exit` frame messages and exit codes for rejected start-profile requests.
- Added CLI regressions for accepted and rejected `start --profile` daemon responses.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/061-cli-start-ignores-profile-rejection.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-start.test.ts test/unit/cli-stop.test.ts test/unit/ipc-server.test.ts`
- `pnpm typecheck`

### Residuals
- The start-relay log-frame residue was later resolved by issue 174.

## Milestone 58 — Risky workspace confirmation capability round

Status: complete

### Delivered
- Changed risky workspace staging to return an opaque runtime confirmation token instead of reusing the raw filesystem path.
- Kept risky workspace entries staged in memory until confirmation, preserving the Chapter 5.3.2 no-persist-before-confirmation law.
- Added store regressions proving raw-path confirmation fails and opaque-token confirmation persists once.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/062-risky-workspace-path-token.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts test/unit/web-server-renew.test.ts`
- `pnpm typecheck`

### Residuals
- Risky workspace confirmation tokens are process-local; daemon restart clears pending confirmations instead of restoring them.

## Milestone 59 — Refresh-token action source round

Status: complete

### Delivered
- Moved `refresh-token` confirmation ahead of scheduler credential lookup so renewal can be requested even when old credentials are missing.
- Preserved the credential wall for write-capable publish, placeholder, and OIDC Events.
- Added a proactive-event regression proving missing loaded credentials still resolve refresh-token as `action-required`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/063-refresh-token-requires-old-credentials.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Resolved by Milestone 60: write-capable Events without loaded credentials now resolve as `action-required` while preserving the no-write boundary.

## Milestone 60 — Write-event missing credential status round

Status: complete

### Delivered
- Changed the scheduler credential wall so write-capable Events without loaded credentials resolve as `action-required` instead of `failed`.
- Preserved the no-write boundary: missing credentials still return before pack, publish, placeholder, or OIDC execution.
- Added a proactive-event regression proving a missing-credential placeholder Event requires credential input and performs no write-side calls.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/064-write-events-missing-credentials-failed.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- The action-required renew copy residue was later resolved by issue 065.

## Milestone 61 — Renew state projection copy round

Status: complete

### Delivered
- Routed expired and action-required Event renew actions to `/renew` with an explicit `reason` projection.
- Updated the shared renew page to render separate heading and intro copy for expired-token and credential re-apply states.
- Kept backend renewal API and Event ontology unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/065-renew-page-action-required-copy.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The direct-route expired-token copy residue was later resolved by issue 066.

## Milestone 62 — Renew direct-route neutral copy round

Status: complete

### Delivered
- Added an explicit `direct` projection state for `/renew` visits without an Event-backed reason.
- Preserved expired-token copy only for `/renew?reason=expired`.
- Kept action-required and direct renew routes on neutral credential re-apply copy.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/066-renew-direct-route-expired-copy.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The renew document-title residue was later resolved by issue 067.

## Milestone 63 — Renew document-title projection round

Status: complete

### Delivered
- Changed the renew route document title to derive from the same state-specific heading as the page body.
- Preserved `Renew Token · pnpm-pub` only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on `Re-apply Credentials · pnpm-pub`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/067-renew-document-title-projection.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The renew submit-button residue was later resolved by issue 068.

## Milestone 64 — Renew submit-button projection round

Status: complete

### Delivered
- Added route-reason-derived idle and busy labels for the renew page submit button.
- Preserved `Renew token` / `Renewing…` only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on `Re-apply credentials` / `Re-applying…`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/068-renew-submit-button-projection.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The renew default-error fallback residue was later resolved by issue 069.

## Milestone 65 — Renew default-error projection round

Status: complete

### Delivered
- Added a route-reason-derived default error fallback for the renew page.
- Preserved `Renew failed.` only for `/renew?reason=expired`.
- Kept `action-required` and direct renew routes on `Credential re-apply failed.` when the API returns no explicit error.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/069-renew-default-error-projection.md`.

### Verification
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The rendered renew route-state browser evidence gap was later resolved by issue 170.

## Milestone 66 — Renew projection regression round

Status: complete

### Delivered
- Extracted renew route reason normalization and copy projection into `webui/src/lib/renew-projection.ts`.
- Updated the renew Svelte route to render heading, document title, submit labels, and fallback errors from the projection atom.
- Added `test/unit/renew-projection.test.ts` to assert expired, action-required, direct, and unknown-query behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/070-renew-projection-regression-coverage.md`.

### Verification
- `pnpm exec vitest run test/unit/renew-projection.test.ts`
- `pnpm --filter ./webui run check`
- `pnpm typecheck`

### Residuals
- The renew document-title browser evidence gap was later resolved by issues 071 through 074.

## Milestone 67 — Renew browser-title evidence round

Status: complete

### Delivered
- Verified the renew route document title in a real browser against the local SvelteKit dev server.
- Proved `/renew?reason=expired` resolves to `Renew Token · pnpm-pub`.
- Proved `/renew?reason=action-required` and direct `/renew` resolve to `Re-apply Credentials · pnpm-pub`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/071-renew-title-browser-evidence.md`.

### Verification
- `agent-browser --session pnpm-pub-renew-title open 'http://localhost:5173/renew?reason=expired'`
- `agent-browser --session pnpm-pub-renew-title get title`
- `agent-browser --session pnpm-pub-renew-action open 'http://localhost:5173/renew?reason=action-required'`
- `agent-browser --session pnpm-pub-renew-action get title`
- `agent-browser --session pnpm-pub-renew-direct open http://localhost:5173/renew`
- `agent-browser --session pnpm-pub-renew-direct get title`

### Residuals
- The browser-title acceptance was later committed as an automated regression by issues 072 through 074.

## Milestone 68 — Renew browser-title CI regression round

Status: complete

### Delivered
- Added `agent-browser@0.31.1` as a root dev dependency so browser-title checks do not rely on a hidden global CLI.
- Added `test/unit/renew-route-title.test.ts` to start the WebUI Vite dev server on a free localhost port and read document titles through `agent-browser`.
- Covered `/renew?reason=expired`, `/renew?reason=action-required`, and direct `/renew` in the committed regression.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/072-renew-title-browser-ci-regression.md`.

### Verification
- `pnpm exec vitest run test/unit/renew-route-title.test.ts`

### Residuals
- The browser-backed regression was later moved into the dedicated browser lane by issues 073 and 074.

## Milestone 69 — Renew browser-test lane round

Status: complete

### Delivered
- Moved the renew document-title browser regression from `test/unit/` to `test/browser/`.
- Added `vitest.browser.config.ts` as the dedicated browser-backed WebUI regression lane.
- Added `pnpm test:browser` and excluded `test/browser/**` from the default unit Vitest config.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/073-renew-browser-test-lane.md`.

### Verification
- `pnpm test:browser`
- `pnpm exec vitest run test/unit/renew-projection.test.ts`

### Residuals
- The default `pnpm test` gate was later updated to run the browser lane by issue 074.

## Milestone 70 — Default test browser-lane round

Status: complete

### Delivered
- Updated the root `pnpm test` script to run the unit lane followed by `pnpm test:browser`.
- Kept `pnpm test:browser` as the focused browser-backed WebUI regression command.
- Preserved the unit Vitest config exclusion for `test/browser/**` so the default script does not duplicate browser tests.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/074-default-test-skips-browser-lane.md`.

### Verification
- `pnpm test`

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.

## Milestone 71 — Dockerized E2E exit-status round

Status: complete

### Delivered
- Replaced the shell-chain `test:e2e:docker` command with `scripts/run-e2e-docker.ts`.
- Preserved Docker cleanup after successful Verdaccio startup.
- Preserved the E2E test failure exit status instead of letting `docker compose down -v` mask it.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/075-e2e-docker-exit-status.md`.

### Verification
- `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --types node scripts/run-e2e-docker.ts`

### Residuals
- This round type-checks the Docker wrapper but does not start Dockerized Verdaccio in verification.

## Milestone 72 — Dockerized E2E daemon-preflight round

Status: complete

### Delivered
- Added a Docker daemon preflight to `scripts/run-e2e-docker.ts`.
- Kept `docker compose up` behind a reachable-daemon check.
- Made the stopped-daemon path print an explicit `Docker daemon is not reachable` message.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/076-e2e-docker-daemon-preflight.md`.

### Verification
- `pnpm test:e2e:docker` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 227 — Publish bare profile rejection round

Status: complete

### Delivered

- Rejected malformed bare `--profile` inputs when the next token is missing or begins with `-`.
- Preserved explicit `--profile=value` and `--profile value` behavior for valid profile overrides.
- Prevented a publish flag from being consumed as a profile name before IPC or daemon boot.
- Added regression coverage for `pnpm-pub publish --profile --dry-run` failing locally without IPC.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/231-publish-bare-profile-consumes-next-flag.md`.

### Verification

- `pnpm exec vitest run test/unit/cli-handshake.test.ts`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON, recursive package facts, bundled dependency sections, single-package `--config.*` warnings, CLI terminal-only publish intents, and malformed bare `--profile` rejection, but exact byte-for-byte npm notice rendering may still drift for unusual npm warning preambles.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 73 — E2E fixture comment hygiene round

Status: complete

### Delivered
- Removed a duplicated public helper comment above `writeFixturePackage` in `test/e2e/publish-intercept.test.ts`.
- Preserved the E2E fixture implementation and runtime behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/077-e2e-fixture-duplicate-comment.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 74 — CLI stop test evidence round

Status: complete

### Delivered
- Replaced the CLI stop regression's `as unknown as` mock-internals assertion with typed IPC request recording.
- Asserted the emitted `{ command: 'stop' }` frame directly through `FrameReader`.
- Renamed the focused test with a Given/When/Then scenario statement.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/078-cli-stop-double-cast-test-evidence.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-stop.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 75 — IPC server socket-boundary test round

Status: complete

### Delivered
- Replaced IPC server tests that called private `dispatch` with a public socket request helper.
- Sent typed `IpcRequest` frames through `net.createConnection(socketPath())` and decoded `IpcFrame` responses through `FrameReader`.
- Preserved behavior coverage for start profile override, missing profile rejection, newer CLI self-destruct, and older CLI silent handshake.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/079-ipc-server-private-dispatch-test-boundary.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/ipc-server.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 76 — WebUI protocol parity guard round

Status: complete

### Delivered
- Added `test/unit/webui-protocol-types.test.ts` as a type-level parity guard for the WebUI protocol mirror.
- Compared WebUI mirror types against shared daemon contracts for profiles, workspaces, publish targets, event payloads, events, backups, and WebSocket messages.
- Kept the guard type-only so it does not change the WebUI runtime bundle.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/080-webui-protocol-mirror-parity-guard.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/webui-protocol-types.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 77 — TOTP epoch contract comment round

Status: complete

### Delivered
- Updated `generateTotpAt` documentation in `src/daemon/totp.ts` to describe the current epoch-scoped otplib clone.
- Removed the stale claim that the helper temporarily monkey-patches `Date.now`.
- Preserved runtime TOTP and clock-drift behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/081-totp-epoch-comment-drift.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/totp.test.ts test/unit/drift.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 78 — TOTP RFC evidence boundary round

Status: complete

### Delivered
- Updated `test/unit/totp.test.ts` so the file header separates HOTP truncation evidence from RFC 6238 TOTP time-step evidence.
- Changed the RFC 6238 Appendix B vector test to use `totp.clone({ epoch })` directly instead of a HOTP counter surrogate.
- Preserved runtime TOTP generation behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/082-totp-rfc6238-surrogate-evidence.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/totp.test.ts test/unit/drift.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 79 — CLI start typed frame evidence round

Status: complete

### Delivered
- Replaced the CLI start regression's `unknown[]` IPC recorder with typed `IpcRequest[]` recording.
- Reused the shared `FrameReader` to decode socket chunks instead of hand-parsing newline-delimited JSON in the test.
- Renamed the start-profile regressions with Given/When/Then scenario statements.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/083-cli-start-unknown-frame-recorder.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-start.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 80 — Main entrypoint typed boot-options evidence round

Status: complete

### Delivered
- Replaced the main-entry regression's anonymous boot-options cast with the exported `DaemonOptions` contract.
- Kept the packaged daemon entrypoint behavior unchanged.
- Renamed the release-entrypoint regression with a Given/When/Then scenario statement.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/084-main-entry-boot-options-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/main-entry.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 81 — CLI handshake typed frame evidence round

Status: complete

### Delivered
- Replaced `test/unit/cli-handshake.test.ts` stringified captured IPC frames with typed `IpcRequest[]` capture.
- Added local request guards so the in-process daemon test server dispatches from protocol fields instead of substring matches.
- Asserted status, publish profile override, passthrough args, and package-version handshakes against typed frame fields.
- Renamed the touched handshake regressions with Given/When/Then scenario statements.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/085-cli-handshake-stringified-frame-evidence.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 82 — Main entrypoint process-exit mock removal round

Status: complete

### Delivered
- Removed the `process.exit` spy and `as never` mock from `test/unit/main-entry.test.ts`.
- Kept the release entrypoint regression on the live-daemon boot path with a truthy mocked boot result.
- Preserved package-version and non-headless tray assertions.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/086-main-entry-process-exit-mock.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/main-entry.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 83 — CLI handshake redundant spawn mock removal round

Status: complete

### Delivered
- Removed the scenario-local `vi.mocked(spawn).mockImplementation(... as never)` override from `test/unit/cli-handshake.test.ts`.
- Kept daemon retry tests on the suite-level no-op `node:child_process` mock.
- Preserved daemon-outdated retry, connection-count, and package-version handshake assertions.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/087-cli-handshake-redundant-spawn-never-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 84 — CLI handshake unused spawn argument cleanup round

Status: complete

### Delivered
- Removed the unused `unknown[]` variadic argument from the suite-level `child_process.spawn` mock in `test/unit/cli-handshake.test.ts`.
- Kept the mock as a single no-op spawn source for the daemon-outdated retry regression.
- Preserved the typed IPC frame evidence and package-version handshake assertions.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/088-cli-handshake-unused-spawn-unknown-args.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 85 — CLI stop socket mock type-safety round

Status: complete

### Delivered
- Replaced the `EventEmitter` method patching and `as never` casts in `test/unit/cli-stop.test.ts` with a local typed `CliStopMockSocket` class.
- Preserved the stop command IPC frame recording and terminal acknowledgement assertions.
- Kept the runtime CLI and daemon code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/089-cli-stop-socket-never-casts.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-stop.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 86 — CLI start socket mock type-safety round

Status: complete

### Delivered
- Replaced the `EventEmitter` method patching and `as never` casts in `test/unit/cli-start.test.ts` with a local typed `CliStartMockSocket` class.
- Preserved accepted and rejected `start --profile` IPC frame evidence.
- Kept the runtime CLI and daemon code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/090-cli-start-socket-never-casts.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-start.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 87 — Renew WebSocket protocol evidence round

Status: complete

### Delivered
- Replaced the local `{ type: string; workspaces?: unknown[] }` WebSocket projection in `test/unit/web-server-renew.test.ts` with a typed `WsServerMessage` evidence subset.
- Added local guards for profile and workspace message shapes before recording profile-switch rebroadcast evidence.
- Preserved the profile-switch workspace snapshot and selected-profile assertions.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/091-renew-ws-workspace-unknown-projection.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 88 — E2E IPC helper typed request round

Status: complete

### Delivered
- Replaced the `unknown` payload and `as never` cast in the publish interception E2E `sendIpc` helper with the shared `IpcRequest` contract.
- Preserved the real IPC frame encoding path through `encodeFrame`.
- Kept the runtime CLI, daemon, WebUI, and registry code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/092-e2e-ipc-helper-never-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 89 — E2E exit-frame guard round

Status: complete

### Delivered
- Replaced the broad `as IpcFrame` assertion in the publish interception E2E `readExitFrame` helper with an `isIpcExitFrame` guard.
- Preserved daemon exit-code evidence from the shared `IpcFrame` union.
- Kept the runtime CLI, daemon, WebUI, and registry code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/093-e2e-exit-frame-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 90 — E2E packument projection guard round

Status: complete

### Delivered
- Replaced the direct registry packument JSON cast in the publish interception E2E with a `RegistryPackument` guard.
- Preserved before-confirmation and after-confirmation packument evidence for Verdaccio-backed runs.
- Kept the runtime CLI, daemon, WebUI, and registry code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/094-e2e-packument-json-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 91 — E2E publish-document body guard round

Status: complete

### Delivered
- Replaced the direct mock registry PUT body cast in the publish interception E2E with a `RegistryPublishDocument` guard.
- Preserved tarball attachment and package-version publish evidence for mock-registry runs.
- Kept the runtime CLI, daemon, WebUI, and registry code unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/095-e2e-publish-document-body-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 92 — E2E mock registry ingress guard round

Status: complete

### Delivered
- Replaced unchecked mock registry request chunk handling in `test/e2e/publish-intercept.test.ts` with `readRequestBody`.
- Replaced direct `npm-otp` header casts with `singleHeaderValue` for both publish-document and clock-drift registry evidence.
- Preserved the publish interception E2E proof surface: parked intent, WebToken-confirmed publish, bad-token rejection, and OTP drift recovery.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/096-e2e-mock-registry-ingress-casts.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/publish-intercept.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 93 — IPC request boundary guard round

Status: complete

### Delivered
- Replaced broad decoded-frame IPC casts in `src/daemon/ipc-server.ts` with `isIpcRequest`, `isIpcHandshake`, `isIpcPublishRequest`, and `isIpcManagementRequest`.
- Invalid decoded socket frames now receive an explicit `invalid IPC request` exit frame instead of reaching scheduler dispatch.
- Added a real-socket regression in `test/unit/ipc-server.test.ts` proving malformed publish input does not create a pending event.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/097-ipc-request-boundary-casts.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/ipc-server.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The WebSocket client-message cast residue was later resolved by issue 098.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 94 — WebSocket client-message boundary guard round

Status: complete

### Delivered
- Replaced the inbound `WsClientMessage` cast in `src/daemon/web-server.ts` with `handleClientMessage` and `isWsClientMessage`.
- Validated WebSocket `auth`, profile selection, event confirmation/rejection, workspace scan, and proactive event creation messages before dispatch.
- Added a token-authenticated WebSocket regression in `test/unit/web-server-renew.test.ts` proving malformed `create-event` input returns an error toast without creating a pending event.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/098-websocket-client-message-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 95 — Scheduler package metadata guard round

Status: complete

### Delivered
- Replaced the unchecked `package.json` metadata cast in `src/daemon/scheduler.ts` with `parsePackageMetadata`.
- Accepted only string `name`, `version`, and `description` values before turning package metadata into publish event target facts.
- Added a scheduler regression in `test/unit/proactive-events.test.ts` proving malformed package metadata falls back to neutral target facts.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/099-scheduler-package-metadata-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader package and registry decoding surfaces named by this cluster were later resolved by issues 100, 101, 102, 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 96 — Packer package metadata guard round

Status: complete

### Delivered
- Replaced the unchecked `package.json` metadata cast in `src/daemon/packer.ts` with `parsePackageMetadata`.
- Added `isJsonObject` so only non-array object metadata can become the publish document source record.
- Added `test/unit/packer.test.ts` proving non-object package metadata is rejected before pack command discovery or shell execution.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/100-packer-package-metadata-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/packer.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader registry decoding surfaces named here were later resolved by issues 101, 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 97 — NPM token response guard round

Status: complete

### Delivered
- Replaced the successful token-response JSON cast in `src/daemon/npm-api.ts` with `parseTokenResponse`.
- Reused an object guard for `parseNpmError`, removing its record cast at the registry response boundary.
- Added `test/unit/npm-api.test.ts` coverage proving a 200 response with a non-string token does not create a token fact.
- Replaced the touched test's burnable-body cast with a `Buffer.isBuffer` guard.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/101-npm-token-response-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader registry body and transport-error decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 98 — Workspace package metadata guard round

Status: complete

### Delivered
- Replaced unchecked workspace `package.json` metadata casts in `src/daemon/workspace.ts` with an `unknown` parse plus `isRecord` guard.
- Reused the record guard for object-style `repository.url` metadata before turning it into a workspace repository projection.
- Added `test/unit/workspace.test.ts` coverage proving non-object package metadata is ignored instead of becoming scanned package facts.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/102-workspace-package-metadata-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The command-runner stream chunk cast was later resolved by issue 105; the broader registry decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 99 — CLI positional parser guard round

Status: complete

### Delivered
- Replaced the unchecked yargs positional cast in `src/cli/cli.ts` with `toPositionalStrings`.
- Kept explicit daemon command detection behind a tiny `unknown` boundary parser.
- Preserved raw argv extraction for publish passthrough and `--profile` handling.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/103-cli-positional-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/cli-start.test.ts test/unit/cli-stop.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The command-runner stream chunk cast and test-only metadata/header casts were later resolved by issues 104, 105, and 106; the broader registry decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 100 — Clock-drift test header guard round

Status: complete

### Delivered
- Replaced the unchecked `npm-otp` header cast in `test/unit/drift.test.ts` with `firstHeaderValue`.
- Normalized Node's real request header shape before recording OTP attempts in the mock registry.
- Preserved the clock-drift retry and expired-token classification scenarios.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/104-drift-header-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/drift.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The command-runner stream chunk cast and test-only package metadata cast were later resolved by issues 105 and 106; the broader registry decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 101 — Packer command output boundary guard round

Status: complete

### Delivered
- Replaced unchecked child-process stdout/stderr `Buffer` casts in `src/daemon/packer.ts` with `normalizeOutputChunk`.
- Accepted only `Buffer`, `string`, and `Uint8Array` chunks as captured command output.
- Added `test/unit/packer.test.ts` coverage proving unsupported chunk shapes are not promoted into output facts.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/105-packer-output-chunk-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/packer.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The test-only proactive-event package metadata cast was later resolved by issue 106; the broader registry decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 102 — Proactive-events mock metadata guard round

Status: complete

### Delivered
- Replaced the unchecked mock package metadata cast in `test/unit/proactive-events.test.ts` with `parseMockPackageMetadata`.
- Kept parsed package JSON as `unknown` until a local non-array object guard proves it can become mock packer metadata.
- Preserved proactive publish, OIDC setup, credential-required, and workspace-root interception scenarios.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/106-proactive-events-mock-metadata-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader registry decoding surfaces were later resolved by issues 107, 108, and 109.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 103 — Registry body text projection guard round

Status: complete

### Delivered
- Replaced scattered registry response body stringification in `src/daemon/npm-api.ts` with `bodyToText`.
- Routed OTP failure detection, publish stderr, OIDC stderr, and expired-token classification through the shared projection helper.
- Added `test/unit/npm-api.test.ts` coverage proving unstringifiable bodies do not throw and non-JSON OIDC failures do not emit `"null"` stderr facts.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Broader registry-specific response schema parsing was later tightened by issue 175.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 104 — Registry body reader source-conservation round

Status: complete

### Delivered
- Replaced the JSON-only registry body reader in `src/daemon/npm-api.ts` with `readRegistryBody`.
- Preserved non-JSON registry response text as source input while still parsing JSON bodies when possible.
- Reused a single parsed token-apply response body for token parsing and fallback error projection.
- Updated `test/unit/npm-api.test.ts` to prove non-JSON OIDC failure text is preserved in stderr.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Registry-specific response schema parsing was later tightened by issue 175.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 105 — Token apply transport error projection round

Status: complete

### Delivered
- Replaced the token-apply catch path's unchecked `Error` assertion in `src/daemon/npm-api.ts` with `errorToMessage`.
- Reused the shared registry body text projection for non-Error thrown values.
- Added `test/unit/npm-api.test.ts` coverage proving a non-Error fetch rejection preserves the original failure text.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- Registry-specific response schema parsing was later tightened by issue 175.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 106 — Tray host rejection projection round

Status: complete

### Delivered
- Replaced the tray host's unchecked opentray rejection `Error` assertions in `src/daemon/tray-host.ts` with `errorToLogMessage`.
- Preserved normal `Error.message` behavior while keeping non-`Error` thrown values visible in daemon log projection.
- Added `test/unit/tray-host.test.ts` coverage proving string rejections retain their source text for direct show and pending-pin show failures.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/110-tray-host-error-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/tray-host.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader runtime catch paths named here were later resolved by issues 111, 112, 114, and 115.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 107 — WebServer persistence error projection round

Status: complete

### Delivered
- Replaced the WebServer persistence-boundary unchecked `Error` assertions in `src/daemon/web-server.ts` with `errorToMessage`.
- Preserved normal `Error.message` behavior while keeping non-`Error` add-profile, renew, and import failures visible in HTTP error projection.
- Added `test/unit/web-server-renew.test.ts` coverage proving string rejections retain their source text across add-profile, renew, and import rollback paths.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/111-web-server-persistence-error-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The broader runtime catch paths named here were later resolved by issues 112, 114, and 115.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 108 — Scheduler write error projection round

Status: complete

### Delivered
- Replaced the scheduler's unchecked write-execution `Error` assertions in `src/daemon/scheduler.ts` with `errorToMessage`.
- Preserved normal `Error.message` behavior while keeping non-`Error` publish, placeholder, OIDC workflow-write, and OIDC registry setup failures visible in Event and CLI projections.
- Added `test/unit/proactive-events.test.ts` coverage proving string rejections retain their source text across those confirmed write paths.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/112-scheduler-write-error-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The remaining daemon and CLI runtime catch residues were later resolved by issues 114 and 115.
- The avatar response-decoding cast residue was later resolved by issue 113.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 109 — Avatar response decoding projection round

Status: complete

### Delivered
- Replaced the avatar profile response cast in `src/daemon/avatar.ts` with `readAvatarUrl`.
- Kept NPM profile JSON as `unknown` until a local record guard proves `avatar` is a non-empty string.
- Added `test/unit/avatar.test.ts` coverage proving malformed profile JSON does not trigger image fetch/cache writes and valid avatar URLs still cache image bytes.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/113-avatar-response-cast.md`.

### Verification
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)
- `pnpm exec vitest run test/unit/avatar.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals
- The remaining daemon and CLI runtime catch residues were later resolved by issues 114 and 115.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 110 — Daemon runtime error projection round

Status: complete

### Delivered
- Replaced daemon bootstrap/runtime unchecked `Error` assertions in `src/daemon/index.ts` with `errorToLogMessage`.
- Preserved normal `Error.message` behavior while keeping non-`Error` unhandled rejection, opentray mount, and placement-watch failures visible in daemon log projection.
- Added `test/unit/daemon-logging.test.ts` coverage proving string rejections retain their source text across opentray mount and tray placement failures.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/114-daemon-runtime-error-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/daemon-logging.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The CLI top-level catch residue was later resolved by issue 115.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 111 — CLI fatal error projection round

Status: complete

### Delivered
- Replaced the CLI bin-entrypoint unchecked `Error` assertions in `src/cli/cli.ts` with `formatCliFatalError`.
- Preserved normal `Error.stack` / `Error.message` behavior while keeping non-`Error` top-level rejections visible in stderr projection.
- Added `test/unit/cli-fatal-error.test.ts` coverage proving string rejections retain their source text and `Error` values still project diagnostic text.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/115-cli-fatal-error-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-fatal-error.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The current unchecked assertion scan over `src` and `test` only reports historical task-ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 112 — Workspace gitignore wildcard directory round

Status: complete

### Delivered
- Replaced workspace scanner `.gitignore` exact-path-only filtering with internal `GitignoreRules` supporting exact entries and wildcard directory patterns.
- Applied the same ignored-path law to recursive fallback scans and pnpm-workspace-driven package promotion.
- Added `test/unit/workspace.test.ts` coverage proving `packages/*/generated/` is skipped in both fallback and pnpm-workspace glob scans.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/116-workspace-gitignore-wildcard-directories.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Plain name-entry depth handling was later tightened by issue 172; ordered negation handling was later tightened by issue 176.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 113 — WebUI event profile projection round

Status: complete

### Delivered
- Added `webui/src/lib/event-projection.ts` as the WebUI event visibility law.
- Changed `pendingEvents` and `historyEvents` to derive from profile-scoped `visibleEvents` instead of the global daemon event array.
- Preserved the Chapter 6.2 pending context-override exception so explicit CLI profile overrides still surface for confirmation.
- Added `test/unit/event-projection.test.ts` coverage proving sibling profile history is hidden while pending overrides remain visible.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/117-webui-event-profile-projection.md`.

### Verification
- `pnpm exec vitest run test/unit/event-projection.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The daemon still broadcasts global event snapshots; WebUI projection now enforces the visible profile boundary.
- WebUI route catch blocks still contain `as Error` projections in add-profile, backup, and renew pages.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 114 — WebUI route error projection round

Status: complete

### Delivered
- Added `webui/src/lib/error-projection.ts` as the shared WebUI route error projection atom.
- Replaced add-profile, backup export/import, and renew route catch projections with `errorToMessage`.
- Preserved normal `Error.message` rendering while keeping non-`Error` thrown values visible as source text.
- Added `test/unit/webui-error-projection.test.ts` coverage for both `Error` and non-`Error` route failure projection.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/118-webui-route-error-projection.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-error-projection.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The current unchecked assertion scan over live `src`, `webui/src`, and `test` code only reports historical task-ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 129 — Backup REST action EventKind ontology round

Status: complete

### Delivered
- Removed REST-only backup `import` / `export` names from the shared `EventKind` ontology.
- Aligned the daemon WebSocket `create-event` validator with the narrowed confirmable action set.
- Aligned the WebUI protocol mirror and server-message decoder so `export` cannot enter browser Event state as a valid Event kind.
- Added daemon and WebUI decoder regressions proving backup actions stay on the REST API path, not the Event Hub WS path.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/133-backup-actions-eventkind-ontology.md`.

### Verification
- `pnpm exec vitest run test/unit/web-server-renew.test.ts test/unit/webui-ws-message.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "type EventKind|EVENT_KINDS|eventKinds|kind: 'export'|kind: \"export\"|kind: 'import'|kind: \"import\"" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted EventKind scan still reports this milestone's historical ledger text and the focused regression payloads for invalid backup-kind rejection.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 130 — WebSocket reject missing task projection round

Status: complete

### Delivered
- Aligned `reject-event` with `confirm-event` at the WebSocket pending-wall boundary.
- Missing reject task ids now emit the same `No such pending event.` error projection instead of disappearing silently.
- Added a WebSocket regression proving an authenticated missing-task reject creates no Event and returns the explicit error toast.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/134-reject-event-missing-task-silent.md`.

### Verification
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "reject-event|No such pending event|missing-task|134-reject-event" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted reject scan reports the intended protocol branch, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 131 — DELETE profile source conservation round

Status: complete

### Delivered
- Changed `DaemonStore.removeProfile()` to return whether the requested profile source record existed.
- Changed `DELETE /api/profiles` to return `404 { ok: false, error }` for unknown usernames instead of projecting a false successful deletion.
- Added store coverage proving unknown removal leaves profiles, default identity, and profile events unchanged.
- Added WebServer coverage proving missing-profile DELETE does not call keychain deletion and leaves profile truth intact.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/135-delete-profile-missing-source.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "removeProfile\\(|DELETE /api/profiles|Profile ghost not found|135-delete-profile" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted delete-profile scan reports the intended source boundary, focused regressions, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 132 — Profile config orphan default normalization round

Status: complete

### Delivered
- Normalized `profiles.json.default` during load so it can only point at a parsed profile source record.
- Preserved the existing empty-profile fallback by using `""` when no profiles exist.
- Added store coverage proving a valid profile list with an orphan default hydrates to the first real profile.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/136-profile-config-orphan-default.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "orphan default|parsePnpmPubConfig|profiles\\.json\\.default|136-profile-config" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted profile-config scan reports the intended parser boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 133 — Profile config unique username identity round

Status: complete

### Delivered
- Rejected empty profile usernames during `profiles.json` hydration so a profile atom must have a usable Chapter 4.1 ID.
- Rejected duplicate usernames during `profiles.json` hydration so keychain-backed profile identity remains one source record per username.
- Preserved the existing fail-closed empty-config fallback for malformed profile config.
- Added store coverage proving empty and duplicate username configs hydrate to the empty fallback.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/137-profile-config-unique-username.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "empty username|duplicate usernames|unique Profile ID|137-profile-config|parsePnpmPubConfig|parseProfile" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted profile-config scan reports the intended parser boundary, focused regressions, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 134 — Workspace config absolute root path round

Status: complete

### Delivered
- Rejected empty or relative workspace paths during `workspaces.json` hydration so persisted workspace atoms match the Chapter 5.3.3 absolute-root contract.
- Preserved the existing fail-closed empty-config fallback for malformed workspace config.
- Added store coverage proving a relative workspace path hydrates to the empty fallback.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/138-workspace-config-absolute-root-path.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "relative workspace|absolute root|138-workspace-config|parseWorkspacesConfig|parseWorkspaceEntry|path\\.isAbsolute" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted workspace-config scan reports the intended parser boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 135 — Workspace config unique root identity round

Status: complete

### Delivered
- Rejected duplicate absolute root paths during `workspaces.json` hydration so persisted workspace atoms match the same path-identity law used by `addWorkspace()`.
- Preserved the existing fail-closed empty-config fallback for malformed workspace config.
- Added store coverage proving duplicate persisted workspace roots hydrate to the empty fallback.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/139-workspace-config-unique-root-path.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "duplicate root|unique root|139-workspace-config|parseWorkspacesConfig|roots\\.has|roots\\.add" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted workspace-config scan reports the intended parser boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 136 — Workspace config timestamp ontology round

Status: complete

### Delivered
- Rejected negative or fractional `addedAt` values during `workspaces.json` hydration so persisted workspace atoms carry a valid millisecond epoch fact.
- Preserved the existing fail-closed empty-config fallback for malformed workspace config.
- Added store coverage proving an invalid persisted workspace timestamp hydrates to the empty fallback.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/140-workspace-config-added-at-timestamp.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "invalid timestamp|addedAt|140-workspace-config|Number\\.isInteger|millisecond epoch" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted workspace-config scan reports the intended parser boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 137 — WebUI workspace timestamp projection round

Status: complete

### Delivered
- Mirrored the daemon workspace timestamp law in `webui/src/lib/ws-message.ts`.
- Rejected WebSocket `workspaces` frames whose `addedAt` is negative or fractional before they can enter WebUI state.
- Added WebUI WS decoder coverage proving invalid workspace timestamps are rejected.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/141-webui-ws-workspace-added-at-timestamp.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-ws-message.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "workspace timestamp|millisecond-epoch|141-webui-ws|isMillisecondEpoch|addedAt" webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted WebUI timestamp scan reports the intended decoder boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 138 — WebUI event timestamp projection round

Status: complete

### Delivered
- Mirrored the Events timeline timestamp law in `webui/src/lib/ws-message.ts`.
- Rejected WebSocket event frames whose `createdAt` or `resolvedAt` is negative or fractional before they can enter WebUI state.
- Added WebUI WS decoder coverage proving invalid event timestamps are rejected.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/142-webui-ws-event-timestamp-ontology.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-ws-message.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "event timestamp|142-webui-ws|isOptionalMillisecondEpoch|isMillisecondEpoch|createdAt|resolvedAt" webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted WebUI event timestamp scan reports the intended decoder boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 139 — Daemon event resolution metadata boundary round

Status: complete

### Delivered
- Replaced `DaemonStore.resolveEvent()`'s open `Partial<PubEvent>` patch parameter with a named `EventResolutionMetadata` contract.
- Preserved the store-owned event resolution facts: `status`, `resolvedAt`, and optional `result`.
- Preserved the current clock-drift recovery atom through explicit `clockDriftRecovered` metadata.
- Added store coverage proving clock-drift recovery metadata is recorded without widening the event patch surface.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/143-daemon-event-resolution-metadata-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "Partial<PubEvent>|Object\\.assign\\(evt|EventResolutionMetadata|clockDriftRecovered|resolveEvent\\(" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted event-resolution scan reports the intended named metadata boundary, scheduler call sites, focused regression, this milestone's ledger text, and an unrelated `test/unit/event-projection.test.ts` projection-helper `Partial<PubEvent>` residue.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 140 — Event projection fixture patch boundary round

Status: complete

### Delivered
- Replaced the WebUI event projection test helper's open `Partial<PubEvent>` parameter with a named `EventFixtureOptions` contract.
- Preserved the fixture-owned event ontology: `id`, `kind`, `status`, `profile`, and `createdAt`.
- Preserved the only scenario-specific projection option, `profileOverride`, for pending context-override visibility.
- Kept production `filterVisibleEvents()` behavior unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/144-event-projection-fixture-patch-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/event-projection.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "Partial<PubEvent>|Object\\.assign\\(evt|EventFixtureOptions|profileOverride" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted event projection scan reports the intended `EventFixtureOptions` boundary, production `profileOverride` projection usage, historical milestone text from the prior residue, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 141 — Workspace entry field boundary round

Status: complete

### Delivered
- Replaced `DaemonStore.addWorkspace()` broad entry retention and `Object.assign(existing, entry)` update with explicit workspace schema field copying.
- Preserved the Chapter 5 workspace ontology fields: `path`, `pinned`, and `addedAt`.
- Added store coverage proving extra runtime projection fields do not persist after workspace insert or update.
- Kept workspace root discovery, risk confirmation, scanner behavior, and WebUI workspace rendering unchanged.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/145-workspace-entry-field-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "Object\\.assign\\(existing|displayName|workspace entry field|145-workspace|addWorkspace\\(" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted workspace field scan reports the intended explicit copy boundary, focused regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 142 — Keytar runtime surface decoding round

Status: complete

### Delivered
- Replaced direct `KeytarApi` assertions at the dynamic `require()` boundary with `unknown` module reads plus `parseKeytarModule()`.
- Accepted both direct CommonJS keytar surfaces and `default`-wrapped surfaces only after verifying the credential methods used by the daemon.
- Added runtime-boundary coverage proving a malformed keytar module fails closed before credential access.
- Preserved the Chapter 9.2 runtime `require` loading law and Chapter 4.2 account-key mapping.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/146-keytar-runtime-surface-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/keychain-load.test.ts test/unit/keychain.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "as KeytarApi|parseKeytarModule|isKeytarApi|keytar runtime|146-keytar|loadKeytar\\(" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted keytar runtime scan reports the intended decoder boundary, focused malformed-module regression, and this milestone's ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 123 — WebServer static MIME projection round

Status: complete

### Delivered
- Replaced the static file extension `keyof typeof MIME` assertion in `src/daemon/web-server.ts` with `contentTypeFor(file)`.
- Preserved known WebUI MIME types and `application/octet-stream` fallback for unknown asset extensions.
- Added `test/unit/web-server-renew.test.ts` coverage proving CSS content-type projection and unknown-extension fallback through real HTTP responses.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/127-web-server-static-mime-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "path\\.extname\\(file\\) as|keyof typeof MIME|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted static MIME and unchecked JSON assertion scan now only reports historical task-ledger text.
- Broader third-party/framework boundary casts remain outside this static serving path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 124 — WebSocket test socket stub type round

Status: complete

### Delivered
- Replaced the `Object.assign(...) as SocketStub` test double in `test/unit/ws.test.ts` with a concrete `SocketStub` class implementing `SocketLike`.
- Kept captured frame writes as socket-owned state so the Chapter 5.2.3 extended payload evidence no longer depends on a structural assertion.
- Removed the unused `node:net` import from the WebSocket frame test.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/128-websocket-test-socket-stub-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "Object\\.assign\\(emitter|as SocketStub|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader third-party/framework boundary casts remain outside this WebSocket frame test path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 125 — Memfs readFile byte projection round

Status: complete

### Delivered
- Removed the `ArrayBufferLike` assertion from the memfs test adapter's `readFile()` byte-to-text projection.
- Kept the Chapter 10.1.3 workspace scanner tests on the project `FsAPI.readFile(): Promise<string>` law while relying on the upstream `memfs` byte type at the adapter boundary.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/129-memfs-readfile-byte-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "data as ArrayBufferLike|as SocketStub|Object\\.assign\\(emitter|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader third-party/framework boundary casts remain outside this workspace test adapter path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 126 — CLI exit-code catch guard round

Status: complete

### Delivered
- Replaced the remaining `as ExitCode` caught-value reads in `test/unit/cli-start.test.ts` with a local `expectExitCode` guard.
- Replaced the daemon-outdated retry `as ExitCode` caught-value read in `test/unit/cli-handshake.test.ts` with a local `expectExitCode` guard.
- Preserved Chapter 7.2 exit-code pass-through evidence while proving the mocked `process.exit()` throw shape before reading `.code`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/130-cli-exit-code-catch-guards.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-start.test.ts test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "as ExitCode|data as ArrayBufferLike|as SocketStub|Object\\.assign\\(emitter|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader third-party/framework boundary casts remain outside this CLI exit-code test path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 127 — Event card status projection type round

Status: complete

### Delivered
- Replaced the asserted inline `event.status` to badge variant map in `webui/src/lib/components/event-card.svelte` with `STATUS_VARIANTS`.
- Typed the projection as `Record<EventStatus, NonNullable<BadgeVariant>>` so Chapter 6.2 statuses must be intentionally mapped to display variants.
- Preserved event status ontology and changed only the badge color projection boundary.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/131-event-card-status-variant-cast.md`.

### Verification
- `pnpm --filter ./webui check`
- `pnpm typecheck`
- `pnpm exec vitest run test/unit/webui-protocol-types.test.ts test/unit/event-projection.test.ts`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "event\\.status\\].*as|as ExitCode|data as ArrayBufferLike|as SocketStub|Object\\.assign\\(emitter|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader third-party/framework boundary casts remain outside this event-card status projection path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 128 — WebServer upgrade socket contract round

Status: complete

### Delivered
- Replaced the WebServer HTTP `upgrade` path's `socket as import('net').Socket` assertion with the shared `SocketLike` contract.
- Passed the upgrade socket directly through `handleUpgrade()` into `WebSocketConnection`.
- Widened `SocketLike.write()` to accept `Buffer | Uint8Array | string`, matching both WebSocket frame buffers and HTTP upgrade response strings.
- Preserved Chapter 5.2 WebUI HTTP/WebSocket behavior while keeping the transport boundary on the local minimal socket law.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/132-webserver-upgrade-socket-contract.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "socket as import\\('net'\\)\\.Socket|handleUpgrade\\(req, socket as|event\\.status\\].*as|as ExitCode|data as ArrayBufferLike|as SocketStub|Object\\.assign\\(emitter|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader third-party/framework boundary casts remain outside this WebServer upgrade socket path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 122 — WebServer export response test decoding round

Status: complete

### Delivered
- Replaced the `/api/export` test response assertion in `test/unit/web-server-renew.test.ts` with `unknown` response parsing plus `parseExportResponse`.
- Added a test-local `isBackupBundle` guard before decrypting returned backup bundles.
- Preserved the Chapter 8.2 keychain-backed export regression while making the response wrapper part of the evidence.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/126-web-server-export-response-test-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "res\\.json\\(\\)\\) as|Parameters<typeof importBundle>|JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The targeted export-response and unchecked JSON assertion scan now only reports historical task-ledger text.
- Broader third-party/framework boundary casts remain outside this backup export test path.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 115 — WebUI WebSocket message decoding round

Status: complete

### Delivered
- Added `webui/src/lib/ws-message.ts` as the WebUI WebSocket protocol decoder.
- Replaced the store's raw `JSON.parse(ev.data as string) as WsServerMessage` path with `parseWsServerMessage(ev.data)`.
- Validated server message discriminants, profile/workspace/package arrays, events, payloads, and toast messages before they enter Svelte store state.
- Added `test/unit/webui-ws-message.test.ts` coverage for valid profile frames, non-string transport data, and malformed event frames.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/119-webui-ws-message-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-ws-message.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The WebUI REST response decoder residue was later resolved by issue 120.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 116 — WebUI REST response decoding round

Status: complete

### Delivered
- Added `webui/src/lib/rest-response.ts` as the WebUI REST response decoder.
- Replaced add-profile and renew response assertions with `parseTokenApplyResponse`.
- Replaced backup export/import response assertions with `parseExportResponse` and `parseImportResponse`.
- Replaced risky-workspace confirmation response assertion with `parseOkResponse`.
- Added `test/unit/webui-rest-response.test.ts` coverage for valid token fallback, invalid token body, export bundle opacity, malformed import results, and boolean `{ ok }` confirmation.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/120-webui-rest-response-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-rest-response.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The backup import-file decoder residue was later resolved by issue 121.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 117 — WebUI backup bundle decoding round

Status: complete

### Delivered
- Added `webui/src/lib/backup-bundle.ts` as the WebUI decoder for Chapter 8.2 backup wrapper files.
- Removed the backup route's local `BackupBundle` structural guard and `Partial<Record<keyof BackupBundle, unknown>>` projection.
- Preserved distinct malformed-JSON versus invalid-shape projections for backup preview/import errors.
- Added `test/unit/webui-backup-bundle.test.ts` coverage for valid wrappers, malformed JSON, and invalid profile metadata.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/121-webui-backup-bundle-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-backup-bundle.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 118 — Daemon store persistent JSON decoding round

Status: complete

### Delivered
- Replaced `DaemonStore` generic `readJson<T>()` hydration with `unknown` JSON reads plus explicit decoders.
- Added `parsePnpmPubConfig` / `parseProfile` guards for Chapter 4.1 profile config.
- Added `parseWorkspacesConfig` / `parseWorkspaceEntry` guards for Chapter 5.3.3 workspace config.
- Preserved the existing empty-default fallback when config files are missing, unreadable, invalid JSON, or malformed.
- Added `test/unit/store.test.ts` coverage for malformed `profiles.json` and malformed `workspaces.json`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/122-daemon-store-persistent-json-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/store.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The other JSON assertion boundaries named in this milestone were later resolved by issues 123, 124, and 125.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 119 — IPC frame unknown decoding round

Status: complete

### Delivered
- Changed `FrameReader.drain()` to yield `unknown` transport values instead of asserting socket JSON into `IpcRequest | IpcFrame`.
- Added shared `isIpcRequest` and `isIpcFrame` protocol guards in `src/shared/frame.ts`.
- Updated daemon socket handling to reject invalid request frames before dispatch.
- Updated CLI relay, status, and start response handling to validate daemon frames before projecting terminal output or exit codes.
- Added `test/unit/frame.test.ts` coverage for partial frame reads, request/frame promotion, and malformed-frame rejection.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/123-ipc-frame-unknown-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/frame.test.ts test/unit/ipc-server.test.ts test/unit/cli-start.test.ts test/unit/cli-stop.test.ts test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The remaining JSON assertion boundaries named in this milestone were later resolved by issues 124 and 125.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 120 — Crypto decrypted secret decoding round

Status: complete

### Delivered
- Replaced backup import's decrypted `JSON.parse(...) as ProfileSecrets` assertion with `unknown` parsing plus `parseProfileSecrets`.
- Validated decrypted backup plaintext as a profile secret map before it can reach keychain import behavior.
- Preserved existing fail-closed `null` behavior for bad passwords, tampered ciphertext, malformed JSON, and invalid decrypted shapes.
- Added `test/unit/crypto.test.ts` coverage using valid AES-GCM payloads with invalid decrypted content.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/124-crypto-decrypted-secret-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/crypto.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The package-version manifest assertion residue was later resolved by issue 125.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 121 — Package version manifest decoding round

Status: complete

### Delivered
- Replaced `src/shared/package-version.ts` package manifest `JSON.parse(...) as ...` assertions with `unknown` parsing plus `parsePackageManifest`.
- Added `readPackageVersionFrom(startDir)` so package-version resolution can be verified against real filesystem layouts.
- Preserved Chapter 7.2.1 release-truth behavior: only the located `pnpm-pub` manifest with a non-empty string `version` can provide the CLI/daemon handshake version.
- Added `test/unit/package-version.test.ts` coverage for nested resolution, malformed child manifests, and invalid pnpm-pub version metadata.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/125-package-version-manifest-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/package-version.test.ts test/unit/cli-handshake.test.ts test/unit/main-entry.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "JSON\\.parse\\([^\\n]+\\) as|readJson<T>|as T|as unknown|as any|@ts-nocheck" src webui/src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The current unchecked assertion scan over live `src`, `webui/src`, and `test` code only reports historical task-ledger text.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 143 — Opentray runtime surface decoding round

Status: complete

### Delivered
- Replaced the daemon opentray and WebView dynamic-import assertions with local runtime decoders.
- Validated extended tray handles and WebView window handles before they can enter `TrayHost` lifecycle wiring.
- Wrapped placement-kit construction and placement-watch teardown behind checked adapter functions.
- Added daemon logging regressions for malformed tray handles and malformed WebView window handles.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/147-opentray-runtime-surface-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/daemon-logging.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "import\\('opentray'\\).* as|import\\('@opentray/ext-webview'\\).* as|baseTray as|opentray tray handle invalid|isMountedTray|isOpentrayWindow|147-opentray" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 144 — WebSocket inbound frame length boundary round

Status: complete

### Delivered
- Added a daemon-owned max inbound WebSocket client-frame payload size.
- Changed the WebSocket parser from nullable frame parsing to explicit `incomplete` / `invalid` / `frame` states.
- Rejected oversized 64-bit inbound frame lengths before converting them into runtime payload math.
- Centralized connection closure so invalid transport frames and close frames share the same bounded shutdown path.
- Added a focused regression proving an oversized 64-bit client frame closes immediately instead of remaining as pending transport state.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/148-websocket-inbound-frame-length-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "MAX_CLIENT_FRAME_BYTES|status: 'invalid'|1_048_577n|148-websocket|2\\^31" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 145 — WebSocket client mask boundary round

Status: complete

### Delivered
- Changed the daemon WebSocket parser to reject unmasked inbound client frames before payload decoding or JSON dispatch.
- Preserved the existing valid-client path: browser WebSocket clients continue to send masked frames, and server frames remain unmasked.
- Added a focused regression proving an unmasked client text frame creates no message dispatch and closes the connection.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/149-websocket-unmasked-client-frame-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "if \\(!masked\\)|unmaskedClientTextFrame|149-websocket|client mask" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 146 — WebSocket handshake key boundary round

Status: complete

### Delivered
- Tightened `acceptWebSocket()` so the daemon only derives `Sec-WebSocket-Accept` from a single valid 16-byte base64 client nonce.
- Rejected duplicate `sec-websocket-key` header arrays, whitespace-padded keys, malformed base64-like text, and non-16-byte decoded values before upgrade acceptance.
- Added focused handshake regressions for the RFC sample nonce, duplicate header arrays, and malformed nonce text.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/150-websocket-handshake-key-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "isClientWebSocketKey|not-a-websocket-nonce|150-websocket|Sec-WebSocket-Key" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 147 — WebSocket upgrade header boundary round

Status: complete

### Delivered
- Tightened `acceptWebSocket()` so nonce acceptance also requires `Upgrade: websocket`, a `Connection` header containing `upgrade`, and `Sec-WebSocket-Version: 13`.
- Preserved the WebToken authorization boundary in `web-server.ts`; this round only strengthens the protocol upgrade source check.
- Added focused regressions proving nonce-bearing requests with non-WebSocket upgrade, missing connection upgrade token, or wrong WebSocket version do not produce a handshake.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/151-websocket-upgrade-header-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "isHeaderValue|hasHeaderToken|validUpgradeHeaders|151-websocket|Sec-WebSocket-Version" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 148 — WebSocket data frame boundary round

Status: complete

### Delivered
- Tightened the daemon WebSocket parser so only complete text frames and close frames can enter the minimal WebUI channel.
- Rejected fragmented frames before partial payload decoding and unsupported opcodes before daemon JSON dispatch.
- Added focused regressions proving masked binary JSON and fragmented text frames close the connection without dispatching daemon messages.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/152-websocket-data-frame-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "if \\(!fin\\)|opcode !== 0x1|maskedClientFrame|152-websocket|fragmented text frame|binary JSON frame" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 149 — WebSocket reserved-bit boundary round

Status: complete

### Delivered
- Tightened the daemon WebSocket parser so reserved frame bits are rejected when no extensions have been negotiated.
- Removed the stale binary-frame JSON dispatch branch after the parser's supported opcode set was narrowed to text and close.
- Added a focused regression proving an extension-marked text frame closes the connection without dispatching a daemon message.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/153-websocket-rsv-frame-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "reserved =|if \\(reserved\\)|extension-marked text frame|153-websocket|reserved-bit" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 150 — WebSocket close-frame length boundary round

Status: complete

### Delivered
- Tightened the daemon WebSocket parser so close frames with extended payload lengths are rejected as invalid control frames.
- Rejected oversized close-frame lengths immediately after reading the wire length, before waiting for mask or payload bytes.
- Added a focused regression proving an extended close-frame header closes the connection instead of remaining as incomplete transport state.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/154-websocket-close-frame-length-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "opcode === 0x8 && len > 125|clientCloseFrameHeaderWithExtendedLength|154-websocket|close-frame length" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 151 — WebSocket text UTF-8 boundary round

Status: complete

### Delivered
- Tightened text-frame decoding so inbound WebSocket text payloads must be valid UTF-8 before JSON action parsing.
- Replaced replacement-character decoding at the daemon action boundary with a fatal UTF-8 decoder and fail-closed transport handling.
- Added a focused regression proving JSON-looking text bytes containing invalid UTF-8 close the connection without dispatching a daemon message.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/155-websocket-text-utf8-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "TextDecoder|decodeTextPayload|maskedClientInvalidUtf8JsonFrame|155-websocket|invalid UTF-8" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 152 — WebSocket minimal length boundary round

Status: complete

### Delivered
- Tightened the daemon WebSocket parser so extended payload-length markers must use their minimal legal range.
- Rejected 16-bit extended lengths below `126` and 64-bit extended lengths below `65536` before mask or payload decoding.
- Added a focused regression proving a small JSON-looking text frame with non-minimal 16-bit length encoding closes the connection without dispatching a daemon message.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/156-websocket-minimal-length-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "len < 126|wireLength < 65536n|maskedClientPayloadWith16BitLength|156-websocket|non-minimal extended length" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 153 — WebSocket close payload length boundary round

Status: complete

### Delivered
- Tightened the daemon WebSocket parser so close frames with a one-byte payload length are rejected as invalid control frames.
- Rejected impossible close-frame length immediately after decoding the wire length, before waiting for mask or payload bytes.
- Added a focused regression proving a one-byte close payload header closes the connection instead of remaining as incomplete transport state.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/157-websocket-close-payload-length-boundary.md`.

### Verification
- `pnpm exec vitest run test/unit/ws.test.ts` (failed before the parser guard, then passed with 13 tests after the fix)
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "len === 1|clientCloseFrameHeaderWithOneByteLength|157-websocket|one-byte close payload|one-byte payload length" src test tasks/pnpm-pub-v1 --glob '!tasks/pnpm-pub-v1/.issues/closed/*.md'`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 154 — Missing-credential ledger drift round

Status: complete

### Delivered
- Corrected the stale Milestone 59 residual that still claimed write-capable missing-credential Events resolved as `failed`.
- Updated issue `063-refresh-token-requires-old-credentials.md` so its self-review points to the later issue 064 resolution.
- Preserved the current scheduler law: write-capable Events without loaded credentials resolve as `action-required` and perform no pack, publish, or OIDC registry action.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/158-task-ledger-missing-credential-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'needle=$(printf "%s \\x60failed\\x60" "Missing credentials for write-capable Events still resolve as"); ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src'`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 155 — Package-version ledger drift round

Status: complete

### Delivered
- Corrected the stale issue 124 self-review residue that still claimed `src/shared/package-version.ts` contained package manifest JSON assertions.
- Preserved the current release-truth law: package metadata is parsed as `unknown` and promoted only through `parsePackageManifest`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/159-task-ledger-package-version-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/package-version.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'needle="src/shared/package-version.ts still contains package manifest JSON assertion"; needle="${needle}s"; ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 156 — JSON assertion ledger drift round

Status: complete

### Delivered
- Corrected older Milestone 118, 119, and 120 residuals that still described JSON assertion boundaries as current after issues 123, 124, and 125 had resolved them.
- Updated issue `122-daemon-store-persistent-json-decoding.md` and issue `123-ipc-frame-unknown-decoding.md` so their self-review residues point at the later closures instead of stale work.
- Preserved the current source law: IPC frames, decrypted backup secrets, and package manifests are parsed as `unknown` and promoted only through explicit decoders or guards.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/160-task-ledger-json-assertion-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/frame.test.ts test/unit/crypto.test.ts test/unit/package-version.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'tick=$(printf "\x60"); n1="Other JSON assertion boundaries remain in ${tick}src/daemon/crypto.ts${tick}, ${tick}src/shared/frame.ts${tick}, and ${tick}src/shared/package-version.ts${tick}."; n2="JSON assertion boundaries remain in ${tick}src/daemon/crypto.ts${tick} and ${tick}src/shared/package-version.ts${tick}."; n3="${tick}src/shared/package-version.ts${tick} still contains package manifest JSON assertions."; for needle in "$n1" "$n2" "$n3"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 157 — IPC dispatch ledger drift round

Status: complete

### Delivered
- Corrected issue 078's stale self-review residue that still described private `dispatch` casts in `test/unit/ipc-server.test.ts` as current work.
- Preserved the current IPC test law: IPC server behavior is exercised through `IpcServer.start()`, `net.createConnection(socketPath())`, and typed frame guards.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/161-task-ledger-ipc-dispatch-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/ipc-server.test.ts test/unit/cli-stop.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'needle="test/unit/ipc-server.test.ts still contains localized test double-casts"; needle="$needle around private dispatch access"; ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 158 — Renew projection ledger drift round

Status: complete

### Delivered
- Corrected older renew milestones 60 through 64 so their residuals point at the later closure issues 065 through 069 instead of describing already-fixed UI projections as current work.
- Updated issues `064` through `068` so their self-review residues conserve to the later renew projection closures.
- Preserved the current WebUI projection law: only explicit `reason=expired` routes project token renewal; `action-required` and direct routes project neutral credential re-apply.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/162-task-ledger-renew-projection-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/renew-projection.test.ts`
- `pnpm exec vitest run --config vitest.browser.config.ts test/browser/renew-route-title.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="The WebUI renew page copy still"; n1="$n1 says"; n2="Direct visits to"; n2="$n2 /renew still default to expired-token copy"; n3="The document title still"; n3="$n3 says"; n4="The submit button still"; n4="$n4 says"; n5="The default API error fallback still"; n5="$n5 says"; for needle in "$n1" "$n2" "$n3" "$n4" "$n5"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 159 — Runtime catch ledger drift round

Status: complete

### Delivered
- Corrected older runtime-catch residuals in Milestones 106 through 110 so they point at later closure issues instead of describing already-fixed `Error` assertion paths as current work.
- Updated issues `110` through `114` so their self-review residues conserve to the later runtime catch and avatar decoder closures.
- Preserved the current source law: runtime failures enter catch boundaries as `unknown` and are projected through local helpers before reaching logs, HTTP responses, Event results, or CLI stderr.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/163-task-ledger-runtime-catch-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/tray-host.test.ts test/unit/web-server-renew.test.ts test/unit/proactive-events.test.ts test/unit/avatar.test.ts test/unit/daemon-logging.test.ts test/unit/cli-fatal-error.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="Broader runtime catch paths still"; n1="$n1 remain"; n2="Runtime catch paths still"; n2="$n2 remain"; n3="The CLI top-level catch still"; n3="$n3 remains"; n4="A separate response-decoding cast still"; n4="$n4 remains"; for needle in "$n1" "$n2" "$n3" "$n4"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 160 — WebSocket client-message ledger drift round

Status: complete

### Delivered
- Corrected Milestone 93's stale residual that still described `src/daemon/web-server.ts` as having a live WebSocket client-message cast after issue 098 had resolved it.
- Updated issue `097-ipc-request-boundary-casts.md` so its self-review points to the later WebSocket client-message guard closure.
- Preserved the current WebSocket action law: inbound client messages enter `handleClientMessage` as `unknown` and become `WsClientMessage` only through `isWsClientMessage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/164-task-ledger-websocket-client-message-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/web-server-renew.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'needle="src/daemon/web-server.ts"; needle="$needle still has a WebSocket client-message cast at its runtime boundary"; ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 161 — Registry decoding ledger drift round

Status: complete

### Delivered
- Corrected older Milestone 95 through 102 residuals that still described broad registry JSON decoding surfaces as current after issues 107 through 109 had resolved the registry body and transport-error projection boundaries.
- Updated issues `099` through `106` so their self-review residues conserve to the later registry body reader, body text projection, and token-apply error projection closures.
- Preserved the current registry input law: registry responses enter as text, become `unknown` JSON or raw text through `readRegistryBody`, then flow through explicit projection helpers.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/165-task-ledger-registry-decoding-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="Broader registry JSON decoding surfaces"; n1="$n1 remain"; n2="broader registry JSON decoding surfaces"; n2="$n2 remain"; n3="Broader JSON decoding surfaces"; n3="$n3 remain"; n4="broader JSON decoding surfaces"; n4="$n4 remain"; for needle in "$n1" "$n2" "$n3" "$n4"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Future schema-specific npm response parsing remains a possible tightening where issues 107 through 109 already name it.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 162 — WebUI backup bundle ledger drift round

Status: complete

### Delivered
- Corrected Milestone 116's stale residual that still described the backup route as owning a local `BackupBundle` structural guard after issue 121 had extracted the decoder.
- Updated issue `120-webui-rest-response-decoding.md` so its self-review points to the later backup-bundle decoder closure.
- Preserved the current WebUI import-file law: backup JSON text is decoded through `parseBackupBundleJson` before route preview or import state uses the wrapper.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/166-task-ledger-backup-bundle-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-backup-bundle.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="webui/src/routes/backup/+page.svelte"; n1="$n1 still has a local"; n2="BackupBundle structural guard"; n2="$n2 with an internal typed record projection"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 163 — Renew browser-title ledger drift round

Status: complete

### Delivered
- Corrected older Milestone 66 through 69 residuals that still described the renew document-title browser proof as missing, manual-only, or outside the default test gate after later browser-lane rounds had resolved those boundaries.
- Updated issues `071` through `073` so their self-review residues conserve to the later committed regression, dedicated browser lane, and default test-gate closures.
- Preserved the current verification law: `test/browser/renew-route-title.test.ts` owns hydrated title evidence, `pnpm test:browser` runs the browser lane, and root `pnpm test` runs unit tests followed by that browser lane.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/167-task-ledger-renew-browser-title-residue.md`.

### Verification
- `pnpm test:browser`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="No browser-level test currently"; n1="$n1 asserts"; n2="browser-title acceptance remains"; n2="$n2 a manual"; n3="browser-backed regression currently lives"; n3="$n3 in the unit test include set"; n4="pnpm test"; n4="$n4 does not run the browser lane by default"; for needle in "$n1" "$n2" "$n3" "$n4"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src package.json vitest*.config.ts || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 164 — WebUI REST response ledger drift round

Status: complete

### Delivered
- Corrected Milestone 115's stale residual that still described WebUI REST response bodies as using local response-shape assertions after issue 120 had introduced shared REST decoders.
- Updated issue `119-webui-ws-message-decoding.md` so its self-review points to the later REST response decoder closure.
- Preserved the current WebUI REST boundary law: route and store code treat `Response.json()` output as `unknown` and promote it through `parseTokenApplyResponse`, `parseExportResponse`, `parseImportResponse`, or `parseOkResponse`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/168-task-ledger-webui-rest-response-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-rest-response.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="REST response bodies in several WebUI routes"; n1="$n1 still use local response-shape assertions"; n2="after res.json"; n2="$n2 local response-shape assertions"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 165 — OIDC workflow result ledger drift round

Status: complete

### Delivered
- Corrected Milestone 41's stale residual that still described OIDC workflow write failures as stderr-only after issue 052 had changed them into failed Event results.
- Updated issue `045-oidc-workflow-guard-after-registry-action.md` so its self-review points to the later workflow write-failure closure.
- Preserved the current OIDC result law: a registry-side OIDC action may have already occurred, but failed local workflow artifact creation resolves the Event as `failed` and exits non-zero.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/169-task-ledger-oidc-write-result-residue.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="OIDC workflow write failures after"; n1="$n1 a successful registry action"; n1="$n1 are still represented as stderr"; n2="write failures after"; n2="$n2 a successful registry action"; n2="$n2 are still reported as stderr"; n3="registry result controls"; n3="$n3 Event success/failure"; n4="registry result drives"; n4="$n4 Event success/failure"; for needle in "$n1" "$n2" "$n3" "$n4"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Registry-side OIDC may already be configured when the local workflow write fails. The Event reports that partial external side effect as a failed local action instead of success.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 166 — Renew rendered route-state browser round

Status: complete

### Delivered
- Extended the browser-backed renew route regression beyond document titles to rendered heading, submit-label, and default-error fallback projections.
- Proved expired-token routes render `Renew Token`, `Renew token`, and `Renew failed.` while `action-required` and direct routes render credential re-apply projections.
- Updated issues `069-renew-default-error-projection.md` and `070-renew-projection-regression-coverage.md` so their self-review residues point to this browser route-state closure.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/170-renew-route-state-browser-regression.md`.

### Verification
- `pnpm exec vitest run --config vitest.browser.config.ts test/browser/renew-route-title.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="Route-specific renew projections"; n1="$n1 are still verified by type/Svelte checks"; n2="no browser-level test currently"; n2="$n2 asserts that SvelteKit writes the projected document title"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 167 — Package version test-fixture truth round

Status: complete

### Delivered
- Added `test/helpers/package-version.ts` so tests read the root package manifest version through a small unknown-safe decoder.
- Updated the CLI handshake regression to compare `cliVersion` frames against the manifest-backed test source instead of the literal `0.1.0`.
- Updated the daemon entrypoint regression to assert the boot version against the same manifest-backed test source.
- Updated issue `050-cli-daemon-version-hardcoded.md` so its self-review and evidence no longer describe a live test-fixture literal residue.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/171-package-version-test-fixture-literal.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/main-entry.test.ts test/unit/package-version.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="tests still use literal"; n1="$n1 "; n1="${n1}\`0.1.0\` as the expected current fixture version"; n2="still proves the packaged daemon boots with version"; n2="$n2 "; n2="${n2}\`0.1.0\`"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 168 — Workspace gitignore name-entry depth round

Status: complete

### Delivered
- Added a dedicated slashless `.gitignore` name-entry rule set to the workspace scanner so entries like `generated` match path segments below the workspace root instead of only `root/generated`.
- Preserved exact root/path rules and wildcard directory patterns as separate scanner atoms.
- Added workspace regressions proving both fallback scans and pnpm-workspace package globs exclude package directories matched by a plain name entry.
- Updated issues `054-workspace-glob-gitignore-gap.md` and `116-workspace-gitignore-wildcard-directories.md` so their self-review residues point to this later closure instead of describing name-entry depth as unresolved.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/172-workspace-gitignore-name-entry-depth.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1=".gitignore support remains intentionally"; n1="$n1 best-effort for simple path entries"; n2=".gitignore handling remains"; n2="$n2 best-effort and does not implement every Git pattern rule"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Remaining full Git ignore parity beyond ordered exact/name/wildcard/negation directory rules stays outside this lightweight parser atom.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 169 — Renew browser output decoder round

Status: complete

### Delivered
- Replaced the renew browser regression's generic `as T` JSON promotion with an `unknown` parser plus an explicit `RenewRouteState` shape guard.
- Preserved the agent-browser double-encoded-string tolerance while keeping browser CLI output outside route-state ontology until decoded.
- Restored recent milestone chronology so Milestone 168 follows Milestone 167 in the task ledger.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/173-renew-browser-route-state-decoder.md`.

### Verification
- `pnpm exec vitest run --config vitest.browser.config.ts test/browser/renew-route-title.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="function parseAgentBrowserJson"; n1="${n1}<T>"; n2="parseAgentBrowserJson"; n2="${n2}<RenewRouteState>"; n3="JSON.parse(parsed) : parsed)"; n3="$n3 as T"; for needle in "$n1" "$n2" "$n3"; do ! rg -n --fixed-strings "$needle" test/browser/renew-route-title.test.ts || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 170 — CLI start relay log-frame round

Status: complete

### Delivered
- Updated `relayStart()` so `start --profile` now forwards daemon `stdout` and `stderr` frames before consuming `status` or `exit` verdicts.
- Preserved the existing start-profile authority law: success still requires a daemon `status` frame and rejection still conserves to the daemon `exit` frame.
- Extended the CLI start regression harness to emit multiple typed `IpcFrame` responses in one socket chunk.
- Added a regression proving daemon `stderr` preceding a rejected start-profile verdict is preserved in the user's terminal.
- Updated issue `061-cli-start-ignores-profile-rejection.md` so its self-review points to this closure instead of stale relay-frame residue.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/174-cli-start-relay-log-frames.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-start.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="relayStart() currently"; n1="$n1 recognizes"; n2="future management replies should"; n2="$n2 extend"; for needle in "$n1" "$n2"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 171 — Registry response schema decoder round

Status: complete

### Delivered
- Added explicit unknown-safe registry response schema helpers in `src/daemon/npm-api.ts`.
- Rejected blank token response strings so empty values cannot become credential facts.
- Preserved structured npm/CouchDB error projections from `message`, `error`, `reason`, `summary`, `detail`, and npm-style `errors[]`.
- Updated issues `107`, `108`, and `109` so their self-review residues point to this later registry-schema closure.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/175-registry-response-schema-decoding.md`.

### Verification
- `pnpm exec vitest run test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'for needle in "Broader registry response parsing could still be made more explicit" "Future registry-specific response schemas could still be parsed more explicitly" "future registry-specific response schemas could still be parsed more explicitly"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 172 — Workspace gitignore negation round

Status: complete

### Delivered
- Replaced unordered `.gitignore` buckets with ordered exact/name/pattern directory rules in `src/daemon/workspace.ts`.
- Parsed `!` entries as negated source rules instead of dropping them.
- Preserved re-included package directories during both fallback scans and `pnpm-workspace.yaml` package-glob scans.
- Updated issues `116` and `172` so their self-review residues point to this later negation closure.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/176-workspace-gitignore-negation.md`.

### Verification
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'for needle in "Full Git ignore parity, including negation semantics" "full Git ignore parity, including negation semantics" "line.startsWith('\''!'\'') continue"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Remaining full Git ignore parity beyond exact/name/wildcard/negation directory rules stays outside this lightweight parser atom.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 173 — CLI prerelease version handshake round

Status: complete

### Delivered
- Replaced numeric-core-only daemon freshness comparison with semver core plus prerelease ordering in `src/daemon/ipc-server.ts`.
- Preserved release versions as newer than prereleases with the same core.
- Added regressions for release-over-prerelease, prerelease identifier ordering, and prerelease-not-newer-than-release.
- Updated issue `060-cli-patch-version-handshake.md` so its self-review residue points to this prerelease closure.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/177-cli-prerelease-version-handshake.md`.

### Verification
- `pnpm exec vitest run test/unit/ipc-server.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'n1="Prerelease ordering"; n1="$n1 is still reduced"; n2="prerelease ordering"; n2="$n2 is still reduced"; n3="parseVersion"; n3="${n3}Core"; for needle in "$n1" "$n2" "$n3"; do ! rg -n --fixed-strings "$needle" tasks/pnpm-pub-v1 src test webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 174 — Owned module import boundary round

Status: complete

### Delivered
- Replaced the CLI daemon-log path's owned-module `require(...) as typeof import(...)` with the existing shared paths ESM contract.
- Replaced the daemon tray icon path's owned-module `require(...) as typeof import(...)` with a static avatar atom import.
- Preserved Chapter 9's true dynamic require law for Keytar native-addon loading; this round does not convert external/native runtime modules into static imports.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/178-owned-module-runtime-require-casts.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-start.test.ts test/unit/cli-handshake.test.ts test/unit/avatar.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `bash -lc 'for needle in "const { daemonLogPath, ensureAppDirs } = require" "const { trayIconForProfile } = require" "as typeof import"; do ! rg -n --fixed-strings "$needle" src webui/src || exit 1; done'`
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- The remaining `as typeof import` occurrence is a Vitest mock import boundary in `test/unit/cli-handshake.test.ts`; runtime `src` code no longer uses owned-module `require(...) as typeof import(...)` casts.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 175 — CLI handshake mock import boundary round

Status: complete

### Delivered
- Replaced the CLI handshake regression's `importOriginal()` module assertion with typed `vi.importActual`.
- Preserved the same `node:child_process` spawn override while removing the final live `as typeof import` residue from `src`, `webui/src`, and `test`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/179-cli-handshake-mock-import-cast.md`.

### Verification
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "as any|as unknown|@ts-nocheck|Record<string, any>|JSON\\.parse\\([^\\n]+\\) as| as typeof import|require\\(.*\\) as" src webui/src test -S` (expected no matches)
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 176 — OIDC package path source round

Status: complete

### Delivered
- Made `OidcContext.path` required in the shared protocol and WebUI mirror types.
- Rejected `setup-oidc` payloads missing the package path before they can become executable Events.
- Removed the daemon-cwd fallback from OIDC workflow writes; confirmed OIDC writes now conserve to the explicit package path only.
- Added a regression proving repo/name-only OIDC payloads create no executable Event and perform no registry action.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/180-oidc-package-path-required.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/webui-ws-message.test.ts test/unit/webui-protocol-types.test.ts`
- `pnpm typecheck`
- `pnpm --filter ./webui check`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "path\\?: string|isOptionalString\\(value\\.data\\.path\\)|ctx\\.path \\&\\& ctx\\.path\\.length|process\\.cwd\\(\\)" src/daemon/scheduler.ts src/shared/index.ts webui/src/lib/types.ts webui/src/lib/ws-message.ts test/unit/proactive-events.test.ts -S` (expected no matches)
- `find tasks/pnpm-pub-v1 \( -name '*.tmp' -o -name '*NO-TITLE*' \) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 177 — WebUI Event payload type-law round

Status: complete

### Delivered
- Added a shared `EventPayloadData<K>` protocol helper so each concrete Event kind exposes its payload data shape as a first-class type.
- Mirrored that helper in the WebUI protocol types and extended the protocol parity regression to cover all four proactive Event payload mappings.
- Tightened `webui/src/lib/store.ts` so `actions.createEvent()` accepts only the payload shape matching the selected Event kind, while keeping the external WS boundary untrusted.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/181-webui-create-event-payload-type-law.md`.

### Verification
- `pnpm exec vitest run test/unit/webui-protocol-types.test.ts`
- `pnpm --filter ./webui check`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "createEvent\\(kind: Extract<WsClientMessage|payload: unknown\\): void" webui/src/lib/store.ts -S` (expected no matches)
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 178 — Packer source-directory conservation round

Status: complete

### Delivered
- Changed `packPackage()` so `pnpm pack` / `npm pack` writes to a daemon-owned temp directory via `--pack-destination` instead of deleting package-local `*.tgz` files.
- Removed `tarballPath` from `PackResult`; the publish atom now depends on tarball bytes and package metadata rather than a scratch-file projection.
- Added a regression proving existing package-local tarballs survive packing and the generated publish tarball is not written into the source directory.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/182-packer-deletes-package-tarballs.md`.

### Verification
- `pnpm exec vitest run test/unit/packer.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "tarballPath|for \\(const entry of await fsp\\.readdir\\(cwd\\)\\)|fsp\\.unlink\\(path\\.join\\(cwd, entry\\)\\)" src test -S` (expected no matches)
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 179 — Publish dry-run no-registry-write round

Status: complete

### Delivered
- Added scheduler-side dry-run detection for `--dry-run`, `--dry-run=<value>`, and `--no-dry-run`.
- Routed confirmed dry-run publish events through a local pack-only path before credential lookup, so no token/TOTP is required and no registry write can occur.
- Added a regression proving `--dry-run --no-git-checks` packs locally, exits successfully, and never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/183-publish-dry-run-writes-registry.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "Dry run complete; no registry write performed|isDryRunPublish|--no-dry-run" src/daemon/scheduler.ts test/unit/proactive-events.test.ts -S`
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` flag parity remains incomplete beyond the now-enforced `--dry-run` no-write law.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 180 — Publish CLI registry source round

Status: complete

### Delivered
- Added scheduler-side publish registry resolution from raw CLI args, preserving `--registry <url>` and `--registry=<url>`.
- Kept profile registry as the default field while allowing the command-scoped publish source to override it for that publish event only.
- Added regressions proving confirmed publish events pass the CLI registry to `publishPackage()` instead of the profile registry.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/184-publish-cli-registry-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n "resolvePublishRegistry|--registry=http://cli-registry.test|--registry', 'http://cli-registry.test" src/daemon/scheduler.ts test/unit/proactive-events.test.ts -S`
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` flag parity remains incomplete beyond command-scoped `--dry-run` and `--registry` handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 181 — Publish CLI dist-tag source round

Status: complete

### Delivered
- Added scheduler-side publish dist-tag resolution from raw CLI args, preserving `--tag <name>` and `--tag=<name>`.
- Passed the command-scoped dist-tag into `publishPackage()` for publish events while keeping `latest` as the registry-client default.
- Changed the publish document so `dist-tags` uses the requested tag instead of always writing `latest`.
- Added regressions proving scheduler forwarding and registry document output.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/185-publish-cli-tag-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "resolvePublishDistTag|distTag: 'beta'|distTag: 'next'|dist-tags" src/daemon/scheduler.ts src/daemon/npm-api.ts test/unit/proactive-events.test.ts test/unit/npm-api.test.ts`
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` flag parity remains incomplete beyond command-scoped `--dry-run`, `--registry`, and `--tag` handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 182 — Publish CLI access source round

Status: complete

### Delivered
- Added scheduler-side publish access resolution from raw CLI args, preserving `--access <value>` and `--access=<value>`.
- Passed the command-scoped access value into `publishPackage()` for publish events when supplied.
- Changed the publish document so `access` is emitted when the command requested it.
- Added regressions proving scheduler forwarding and registry document output.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/186-publish-cli-access-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/npm-api.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "resolvePublishAccess|access: 'public'|access: 'restricted'|parsed.access" src/daemon/scheduler.ts src/daemon/npm-api.ts test/unit/proactive-events.test.ts test/unit/npm-api.test.ts`
- `find tasks/pnpm-pub-v1 -name '*.tmp' -print -o -name '*NO-TITLE*' -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` flag parity remains incomplete beyond command-scoped `--dry-run`, `--registry`, `--tag`, and `--access` handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 183 — Publish package publishConfig source round

Status: complete

### Delivered
- Added a typed daemon decoder for package `publishConfig.registry`, `publishConfig.tag`, and `publishConfig.access`.
- Preserved package publish defaults in CLI-intercepted publish targets and workspace-scanned package targets.
- Resolved confirmed publish writes with explicit precedence: CLI args first, package `publishConfig` second, profile/default registry last.
- Kept WebUI protocol mirrors and WebSocket decoding aligned with the shared publish target contract.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/187-publishconfig-defaults-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts test/unit/webui-protocol-types.test.ts test/unit/webui-ws-message.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "publishConfig|parsePackagePublishConfig|publish-package-config" src/daemon src/shared/index.ts webui/src/lib test/unit tasks/pnpm-pub-v1`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` parity remains incomplete for other publish flags and recursive/workspace publish behavior.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 184 — Publish directory positional source round

Status: complete

### Delivered
- Added scheduler-side publish source directory resolution from the first non-option positional argument.
- Preserved publish option-value boundaries so `--registry <url>`, `--tag <name>`, `--access <value>`, and related options are not mistaken for package directories.
- Used the resolved directory for package metadata, pending event `cwd`, target path, packing, and publish package identity.
- Added a regression proving `pnpm-pub publish --registry <url> packages/pkg` publishes the requested child package instead of the caller's current package.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/188-publish-directory-argument-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "resolvePublishSourceDirectory|findPublishPositionalArg|publish-directory-argument" src/daemon/scheduler.ts test/unit/proactive-events.test.ts tasks/pnpm-pub-v1`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Tarball positional publishing remains unsupported and needs a tarball metadata source path instead of directory `package.json` parsing.
- Broader `pnpm publish` parity remains incomplete for recursive/workspace publish and other advanced flags.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 185 — Publish tarball positional source round

Status: complete

### Delivered
- Replaced the pending publish event's implicit directory source with an explicit `PublishSource` discriminated union.
- Added tarball source support: existing npm `.tgz` files are gunzipped, decoded for embedded `package.json` metadata, and published as their original bytes.
- Resolved CLI positional publish inputs to either directory or tarball sources before creating the pending event.
- Updated directory publish, tarball publish, and dry-run handling to load from the explicit source instead of assuming the caller's current directory.
- Kept WebUI protocol mirrors and WebSocket decoding aligned with the shared source contract.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/189-publish-tarball-argument-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/packer.test.ts test/unit/webui-protocol-types.test.ts test/unit/webui-ws-message.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "PublishSource|readPackageTarball|publish-tarball-argument|read-tarball-source|source: \\{ kind" src webui test/unit tasks/pnpm-pub-v1`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Broader `pnpm publish` parity remains incomplete for recursive/workspace publish and other advanced flags.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 186 — Recursive publish unsafe fallback round

Status: complete

### Delivered
- Added scheduler-side detection for recursive publish flags: `-r`, `--recursive`, `--recursive=<value>`, and `--no-recursive`.
- Blocked recursive publish confirmation before credential access, packing, tarball reading, or registry writes.
- Added a regression proving `pnpm-pub publish --recursive --filter ./packages/*` does not degrade into a single-package publish.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/190-recursive-publish-single-package-fallback.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`
- `rg -n -S "isRecursivePublish|Recursive publish is not yet supported|publish-recursive-unsupported|190-recursive" src/daemon/scheduler.ts test/unit/proactive-events.test.ts tasks/pnpm-pub-v1`
- `find tasks/pnpm-pub-v1 \\( -name '*.tmp' -o -name '*NO-TITLE*' \\) -print`
- `docker info --format '{{.ServerVersion}}'` (expected failure in this environment: Docker daemon unavailable)

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Broader `pnpm publish` parity remains incomplete for other advanced flags.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 187 — Publish CLI OTP source round

Status: complete

### Delivered
- Added scheduler-side publish OTP resolution from raw CLI args, preserving both `--otp <code>` and `--otp=<code>`.
- Passed explicit CLI OTP through the NPM publish boundary as a one-shot request credential while keeping stored TOTP as the default source.
- Prevented explicit OTP failures from silently retrying with a stored-secret drift OTP, so the registry-visible credential source remains the command fact the user supplied.
- Added regressions proving scheduler forwarding and registry `npm-otp` header behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/191-publish-cli-otp-ignored.md`.

### Verification
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/npm-api.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 188 — Publish report summary artifact round

Status: complete

### Delivered
- Added scheduler-side `--report-summary` detection for single-package publish requests, including `--no-report-summary` and `--report-summary=<value>` toggles.
- Wrote `pnpm-publish-summary.json` after a successful real publish with the pnpm-compatible `{ publishedPackages: [{ name, version }] }` shape.
- Kept dry-run and unsupported recursive publish paths from creating the summary artifact.
- Added regressions proving successful publishes write the summary and dry-run publishes with the same flag do not.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/192-publish-report-summary-ignored.md`.

### Verification
- `pnpm publish --help | rg -n "provenance|publish|recursive|otp|tag|access|registry"`
- temporary `pnpm publish --dry-run --report-summary --no-git-checks` probe
- installed pnpm source scan for `pnpm-publish-summary.json` and `{ publishedPackages }`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Recursive `--report-summary` remains part of that multi-package publish atom rather than this single-package artifact path.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 189 — Publish ignore-scripts packing round

Status: complete

### Delivered
- Added scheduler-side `--ignore-scripts` detection for publish requests, including `--no-ignore-scripts` and `--ignore-scripts=<value>` toggles.
- Threaded ignore-scripts into directory-source packing for real publish and dry-run flows while leaving tarball sources unchanged as already-built artifacts.
- Updated `packPackage()` so normal packing still prefers `pnpm pack`, while ignore-scripts packing uses `npm pack --ignore-scripts` because `pnpm pack` does not expose that CLI option.
- Added regressions proving real publish and dry-run forward ignore-scripts to the packer.
- Added a real packer regression proving a package `prepack` script does not run when `ignoreScripts` is true.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/193-publish-ignore-scripts-ignored.md`.

### Verification
- `pnpm publish --help | sed -n '1,16p'`
- `pnpm pack --help | sed -n '1,120p'`
- installed pnpm source scan for `ignoreScripts` / publish script handling
- `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/packer.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Recursive publish flag parity remains part of that multi-package atom.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, `--ignore-scripts`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 190 — Publish JSON output projection round

Status: complete

### Delivered
- Added scheduler-side `--json` detection as a publish output projection flag, separate from source, credentials, packing, and registry-write laws.
- Real publish success now suppresses daemon human progress on stdout and emits one parseable package JSON summary when `--json` is present.
- Dry-run publish success now emits the same package JSON projection while still packing locally and performing no registry write.
- Preserved non-JSON publish output behavior and existing `--report-summary` / `--ignore-scripts` behavior.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/194-publish-json-output-invalid.md`.

### Verification
- `pnpm publish --help`
- temporary `pnpm publish --dry-run --json --no-git-checks` probe
- temporary `pnpm publish --dry-run --no-git-checks` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Recursive publish flag parity remains part of that multi-package atom, including JSON/report-summary behavior for multi-package results.
- The JSON package projection is intentionally minimal and does not yet reproduce pnpm's full tarball file-list fields.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, `--ignore-scripts`, `--json`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 191 — Publish Git safety gate round

Status: complete

### Delivered
- Added `src/daemon/publish-git-checks.ts` as an independent publish Git-check atom.
- Blocked dirty Git worktrees before dry-run packing, credential access, tarball reading, or registry writes unless `--no-git-checks` is present.
- Blocked publishes from branches outside the default `master|main` publish branch pattern unless `--publish-branch` authorizes the current branch.
- Kept the Git gate separate from the NPM registry boundary and preserved existing non-Git publish behavior for directories outside Git repositories.
- Added direct unit coverage for dirty, bypass, matching publish branch, and disallowed branch behavior.
- Added a scheduler regression proving dirty publishes fail before packing or registry calls.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/195-publish-git-checks-ignored.md`.

### Verification
- `pnpm publish --help`
- temporary native `pnpm publish --dry-run` probe on a non-default branch
- temporary native `pnpm publish --dry-run` probe on a dirty worktree
- `pnpm exec vitest run test/unit/publish-git-checks.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- The Git safety gate does not yet implement pnpm's full upstream "branch is up to date" check.
- Package-manager configuration sources such as `.npmrc` `git-checks=false` are not yet read; only command-source flags are honored in this round.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, `--ignore-scripts`, `--json`, `--no-git-checks`, `--publish-branch`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 192 — Publish Git config source round

Status: complete

### Delivered
- Extended the publish Git-check atom to read the nearest `.npmrc` `git-checks=true|false` source.
- Preserved command-source precedence: explicit CLI `--no-git-checks` disables checks and `--git-checks` re-enables checks over `.npmrc`.
- Kept the config read inside `src/daemon/publish-git-checks.ts`, separate from scheduler routing and NPM registry writes.
- Added regressions proving `.npmrc git-checks=false` permits dirty worktrees and non-default branches, while CLI `--git-checks` re-enables the dirty-worktree block.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/196-publish-git-checks-config-ignored.md`.

### Verification
- temporary native `pnpm publish --dry-run` probe with `.npmrc git-checks=false` on a dirty worktree
- temporary native `pnpm publish --dry-run` probe with `.npmrc git-checks=false` on a non-default branch
- `pnpm exec vitest run test/unit/publish-git-checks.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- The Git safety gate does not yet implement pnpm's full upstream "branch is up to date" check.
- Global/user npm config sources are not yet read; this round only covers nearest project `.npmrc`.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, `--ignore-scripts`, `--json`, `--no-git-checks`, `--publish-branch`, `.npmrc git-checks`, publishConfig defaults, directory source, and tarball source handling.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 193 — Publish Git upstream history round

Status: complete

### Delivered
- Extended the publish Git-check atom to compare `HEAD...@{u}` when a configured upstream exists.
- Blocked publishes when fetched upstream history has commits not contained in local `HEAD`, matching native `ERR_PNPM_GIT_NOT_LATEST` behavior.
- Preserved native ahead-only behavior: local commits not yet pushed do not block publish by themselves.
- Preserved bypass sources: `--no-git-checks` and `.npmrc git-checks=false` skip the upstream comparison.
- Added focused unit coverage for fetched-behind blocking, ahead-only success, and `--no-git-checks` bypass.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/197-publish-git-upstream-check-ignored.md`.

### Verification
- temporary native `pnpm publish --dry-run` probe with fetched upstream commits missing from local `HEAD`
- temporary native `pnpm publish --dry-run` probe with local ahead-only commits
- temporary native `pnpm publish --dry-run --no-git-checks` probe with fetched upstream commits missing from local `HEAD`
- `pnpm exec vitest run test/unit/publish-git-checks.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals
- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- The Git safety gate does not fetch remotes automatically; it compares against the currently fetched upstream refs, matching the bounded local check implemented here.
- Global/user npm config sources are not yet read; current config coverage is nearest project `.npmrc`.
- Broader `pnpm publish` parity remains incomplete for other advanced flags beyond command-scoped `--dry-run`, `--registry`, `--tag`, `--access`, `--otp`, `--report-summary`, `--ignore-scripts`, `--json`, `--no-git-checks`, `--publish-branch`, `.npmrc git-checks`, publishConfig defaults, directory source, tarball source, and fetched upstream history checks.
- `pnpm test:e2e` remains a separate Verdaccio/publish integration lane and is still not part of the default `pnpm test` command.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 194 — Publish JSON tarball file projection round

Status: complete

### Delivered

- Extended the packer tarball parser with a typed package file summary projection: `files`, `unpackedSize`, `entryCount`, and `bundled`.
- Kept tarball bytes as the source of truth for JSON file-list facts; scheduler JSON output now reads those facts from `summarizePackageTarball` instead of inventing projection state.
- Preserved the existing best-effort behavior for invalid tarball mocks or non-npm bytes: JSON still emits the base package summary instead of failing after publish success.
- Added regressions proving real packed `.tgz` bytes produce native-style file-list facts and scheduler `--json` emits those facts when available.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/198-publish-json-file-list-missing.md`.

### Verification

- `pnpm exec vitest run test/unit/packer.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals

- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- The `--json` projection now covers the tarball file-list fields observed in the native probe, but exact native field ordering and every edge-case package metadata field remain broader parity work.
- Global/user npm config sources are not yet read; current config coverage is nearest project `.npmrc`.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 195 — Publish Git user config source round

Status: complete

### Delivered

- Extended the publish Git-check atom to read the user npm config source for `git-checks=true|false`.
- Preserved source precedence as a policy law: CLI flags override project `.npmrc`, project `.npmrc` overrides user config, and user config overrides the built-in enabled default.
- Added regressions proving user config can disable dirty-worktree blocking and project `.npmrc git-checks=true` re-enables the block over user config.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/199-publish-git-checks-user-config-ignored.md`.

### Verification

- `pnpm exec vitest run test/unit/publish-git-checks.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals

- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Global npm config sources are not yet read; current config coverage is command flags, nearest project `.npmrc`, and user npm config.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 196 — Publish Git global config source round

Status: complete

### Delivered

- Extended the publish Git-check atom to read the global npm config source for `git-checks=true|false`.
- Preserved config-source precedence as a policy law: CLI flags, nearest project `.npmrc`, user npm config, global npm config, then built-in enabled default.
- Added regressions proving global config can disable dirty-worktree blocking and user npm config re-enables the block over global config.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/200-publish-git-checks-global-config-ignored.md`.

### Verification

- `pnpm exec vitest run test/unit/publish-git-checks.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals

- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- Environment variable config values such as `NPM_CONFIG_GIT_CHECKS` are not yet read as a policy source; current config-file coverage is command flags, nearest project `.npmrc`, user npm config, and global npm config.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 197 — Publish Git env config source round

Status: complete

### Delivered

- Extended the publish Git-check atom to read npm config environment values for `git-checks=true|false`.
- Preserved source precedence as a policy law: CLI flags, npm config environment, nearest project `.npmrc`, user npm config, global npm config, then built-in enabled default.
- Added regressions proving env config can disable dirty-worktree blocking, CLI flags re-enable the block over env config, and env config re-enables the block over project `.npmrc`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/201-publish-git-checks-env-config-ignored.md`.

### Verification

- `pnpm exec vitest run test/unit/publish-git-checks.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals

- Full recursive/workspace publish remains unimplemented and needs a dedicated multi-package publish atom instead of a single-event package fallback.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 198 — Recursive publish dry-run workspace pack round

Status: complete

### Delivered

- Split publish JSON formatting into a reusable tarball-derived projection so single-package and recursive dry-run paths share the same file facts.
- Added a recursive `--dry-run` execution path that resolves the workspace root, scans public workspace packages, applies simple `--filter` path/name matching, and packs each selected package without credentials or registry writes.
- Preserved the safety wall for real recursive registry writes: recursive publish without `--dry-run` still fails before any package packing or NPM write.
- Added regressions proving recursive dry-run packs workspace packages, skips private packages, honors a simple path filter, and never calls `publishPackage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/202-publish-recursive-dry-run-unsupported.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --no-git-checks` probe for root/workspace/private package behavior
- native temporary `pnpm publish -r --dry-run --no-git-checks --filter ./packages/a` probe for path-filter behavior
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity is intentionally simple in this round: exact package names, relative paths, and basic `*`/`**` path globs are covered, but advanced pnpm selector syntax remains future parity work.
- Recursive `--json` now emits a daemon-owned JSON array projection; exact native recursive stdout/stderr formatting remains broader parity work.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 199 — Recursive publish package-name glob filter round

Status: complete

### Delivered

- Extended recursive dry-run filter matching so glob filters are evaluated against package names as well as relative package paths.
- Preserved existing exact package-name filters and relative path filters while adding native-style package-name glob coverage for selectors such as `native-recursive-*` and `@scope/*`.
- Added regressions proving unscoped and scoped package-name glob filters pack only matching workspace packages and never call `publishPackage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/203-publish-recursive-filter-name-glob.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --no-git-checks --filter 'native-recursive-*'` probe for unscoped package-name glob behavior
- native temporary `pnpm publish -r --dry-run --no-git-checks --filter '@scope/*'` probe for scoped package-name glob behavior
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity still does not implement the full pnpm selector language, including dependency/dependent graph selectors, since this round only covered package-name glob matching.
- Recursive `--json` still emits a daemon-owned JSON array projection; exact native recursive stdout/stderr formatting remains broader parity work.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 200 — Recursive publish json stdout projection round

Status: complete

### Delivered

- Replaced the recursive dry-run `--json` daemon-owned JSON array with native-style `+ name@version` stdout lines.
- Preserved the no-registry-write law: recursive dry-run still packs local workspace packages and never calls `publishPackage`.
- Kept single-package `--json` unchanged because that projection follows the earlier single-package publish contract.
- Added a regression proving recursive dry-run `--json` emits only native-style success lines on stdout, avoids daemon progress text, and performs no registry writes.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/204-publish-recursive-json-array-projection.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --json --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity still does not implement the full pnpm selector language, including dependency/dependent graph selectors.
- Recursive stdout/stderr parity is closer for `--json`, but non-json recursive notices and progress text still do not exactly mirror native pnpm output.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 201 — Recursive publish dry-run stdout parity round

Status: complete

### Delivered

- Replaced non-json recursive dry-run daemon progress text with native-style `+ name@version` stdout lines.
- Unified recursive dry-run stdout behavior across regular and `--json` calls while keeping the event result as internal resolution metadata.
- Preserved the no-registry-write law: recursive dry-run still only packs local workspace packages and never calls `publishPackage`.
- Added a regression proving regular recursive dry-run stdout contains success lines only, with no daemon packing or completion text.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/205-publish-recursive-dry-run-progress-output.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity still does not implement the full pnpm selector language, including dependency/dependent graph selectors.
- Recursive dry-run stdout now matches native success-line shape, but stderr still lacks native npm notice details from the package tarball.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 202 — Recursive publish negated filter round

Status: complete

### Delivered

- Added recursive dry-run selector algebra for negated filters.
- Preserved existing positive exact-name, package-name glob, and relative-path filter behavior while allowing `!filter` entries to subtract matching packages.
- Matched native behavior for negation-only filters by starting from all workspace packages, then subtracting excluded matches.
- Matched native behavior for mixed positive and negated filters by selecting positive matches first, then subtracting excluded matches.
- Added regressions proving negation-only and positive-plus-negation recursive dry-run filters pack the expected packages and never call `publishPackage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/206-publish-recursive-filter-negation.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --no-git-checks --filter '!native-neg-b'` probe
- native temporary `pnpm publish -r --dry-run --no-git-checks --filter 'native-neg-*' --filter '!native-neg-b'` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity still does not implement dependency/dependent graph selectors or other advanced pnpm selector syntax beyond exact, glob, path, and negation matching.
- Recursive dry-run stderr still lacks native npm notice details from the package tarball.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 203 — Recursive publish dry-run stderr notice round

Status: complete

### Delivered

- Added native-style `npm notice` stderr projection for recursive dry-run packages when tarball summary facts are available.
- Derived notice contents from packed tarball bytes, package publish configuration, and CLI arguments while preserving the no-registry-write law.
- Preserved recursive dry-run stdout as native-style `+ name@version` success lines only.
- Added a regression proving notice contents, package publishConfig registry/tag/access projection, and absence of `publishPackage` calls.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/207-publish-recursive-dry-run-stderr-notices.md`.

### Verification

- native temporary `pnpm publish -r --dry-run --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive filter parity still does not implement dependency/dependent graph selectors or other advanced pnpm selector syntax beyond exact, glob, path, and negation matching.
- Recursive dry-run stderr notice formatting now covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 204 — Recursive publish no-match filter parity round

Status: complete

### Delivered

- Matched native recursive dry-run no-match filter behavior as a no-op success.
- Changed the daemon projection from failed stderr `No workspace packages matched...` to stdout `No projects matched the filters in "<root>"` with exit 0.
- Preserved the no-registry-write law and proved no pack/read/publish calls are made for no-match filters.
- Added a regression covering event status, stdout/stderr projection, exit code, and skipped package operations.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/208-publish-recursive-filter-no-match-exit.md`.

### Verification

- native temporary recursive publish dry-run filter probes for no-match behavior
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive graph selector parity remains unimplemented; native `publish -r --dry-run` graph selector expansion is not clear enough from current probes to encode a broader law yet.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- The Git safety gate still compares against currently fetched upstream refs and does not fetch remotes by itself.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 205 — Recursive publish graph selector parity round

Status: complete

### Delivered

- Added package dependency-name facts to the workspace scanner from `dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`.
- Added recursive dry-run graph selector expansion for `pkg...`, `pkg^...`, `...pkg`, and `...^pkg`.
- Preserved native ordering for the covered graph closures: dependencies are packed before the selected package, and dependents are packed after the selected package.
- Preserved the no-registry-write law: graph selector expansion only changes the dry-run pack set and still never calls `publishPackage`.
- Added regressions for dependency graph selection, dependent graph selection, and dependency source-fact scanning.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/209-publish-recursive-graph-selectors.md`.

### Verification

- native installed workspace graph selector probes:
  - `pnpm publish -r --dry-run --no-git-checks --filter pkg...`
  - `pnpm publish -r --dry-run --no-git-checks --filter pkg^...`
  - `pnpm publish -r --dry-run --no-git-checks --filter ...pkg`
  - `pnpm publish -r --dry-run --no-git-checks --filter ...^pkg`
- native publish dry-run remote-fetch probe showing pnpm does not fetch remotes during git checks
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, negation, dependency graph, and dependent graph selectors, but other advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- The previous git-fetch residual is reclassified: native `pnpm publish --dry-run` did not fetch remotes in the probe, so the current no-fetch behavior is not a parity gap unless the spec changes.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 206 — Recursive publish report-summary parity round

Status: complete

### Delivered

- Matched native recursive dry-run `--report-summary` behavior for selected packages.
- Added a typed multi-package summary writer for `pnpm-publish-summary.json` while keeping single-package summary output on the existing source path.
- Wrote recursive dry-run summary artifacts at the resolved workspace root using package names and versions from packed package metadata.
- Preserved native no-match behavior: recursive dry-run with no selected packages exits 0 and does not create a summary artifact.
- Preserved the no-registry-write law: recursive dry-run still packs only and never calls `publishPackage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/210-publish-recursive-report-summary.md`.

### Verification

- native recursive dry-run report-summary probe:
  - `pnpm publish -r --dry-run --report-summary --no-git-checks`
- native recursive dry-run no-match report-summary probe:
  - `pnpm publish -r --dry-run --report-summary --filter missing-pkg --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity covers exact, glob, path, negation, dependency graph, dependent graph, and now report-summary projection, but other advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 207 — Recursive publish brace directory selector round

Status: complete

### Delivered

- Matched native recursive dry-run full-brace directory selector behavior for selectors such as `{packages/pkg}`.
- Added a selector normalization law that unwraps selectors entirely wrapped in `{...}` before existing path/glob matching.
- Preserved existing exact-name, ordinary path, glob, negation, and graph selector paths; graph selector composition benefits because seed matching delegates to the same matcher.
- Added a regression proving a brace directory selector packs only the matching workspace package and never calls `publishPackage`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/211-publish-recursive-brace-directory-selectors.md`.

### Verification

- native recursive dry-run brace selector probes:
  - `pnpm publish -r --dry-run --filter '{packages/a}' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '{packages/*}' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '{packages/a}...' --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, and full-brace directory selectors, but combined package-name-plus-directory selectors still need native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 208 — Recursive publish combined selector round

Status: complete

### Delivered

- Matched native recursive dry-run combined package-plus-directory selector behavior for selectors such as `pkg{packages/*}`.
- Replaced literal brace handling with a typed recursive selector parser that separates optional package selectors from trailing `{directory}` selectors.
- Preserved full-brace directory selectors as directory-only selectors while requiring combined selectors to satisfy both package identity and directory scope.
- Preserved graph selector composition for combined selectors, so `pkg{dir}...` expands dependency closures from the intersected seed.
- Added regressions for selector intersection and combined graph selector ordering, both preserving the no-registry-write law.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/212-publish-recursive-combined-package-directory-selectors.md`.

### Verification

- native recursive dry-run combined selector probes:
  - `pnpm publish -r --dry-run --filter 'native-combo-a{packages/*}' --no-git-checks`
  - `pnpm publish -r --dry-run --filter 'native-combo-*{packages/a}' --no-git-checks`
  - `pnpm publish -r --dry-run --filter 'native-combo-a{packages/a}...' --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, and combined package-plus-directory selectors, but changed-since selectors such as `[origin/main]` still need native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 209 — Recursive publish changed-since selector round

Status: complete

### Delivered

- Matched native recursive dry-run changed-since selector behavior for selectors such as `[HEAD]`.
- Added a git-backed recursive selector source that reads `git diff --name-only <ref>` at the recursive workspace root.
- Mapped changed files to owning workspace package directories, selecting package facts rather than treating changed file paths as output truth.
- Preserved graph selector composition for changed-since selectors, so `...[HEAD]` expands dependents from changed package seeds.
- Added regressions using real temporary git repositories for direct `[HEAD]` package selection and `...[HEAD]` dependent expansion.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/213-publish-recursive-changed-since-selectors.md`.

### Verification

- native recursive dry-run changed-since probes:
  - `pnpm publish -r --dry-run --filter '[HEAD]' --no-git-checks`
  - root-only no-match `pnpm publish -r --dry-run --filter '[HEAD]' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '...[HEAD]' --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, and changed-since selectors, but production-only filter behavior such as `--filter-prod` still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 210 — Recursive publish filter-prod graph edge round

Status: complete

### Delivered

- Matched native recursive dry-run `--filter-prod` graph behavior for production-only dependency traversal.
- Split workspace package graph facts into all dependency edges and production dependency edges.
- Preserved direct selector matching for `--filter-prod`, while dependency and dependent graph closures now use only `dependencies`, `optionalDependencies`, and `peerDependencies`.
- Preserved negation/source algebra by carrying each selector's edge kind through include and exclude expansion.
- Added regressions proving `--filter-prod app...` excludes dev dependencies and `--filter-prod ...devDep` does not pull a dev-only dependent.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/214-publish-recursive-filter-prod-graph-edges.md`.

### Verification

- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm exec vitest run test/unit/workspace.test.ts`
- `pnpm typecheck`
- `git diff --check`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, and production-only graph traversal; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 211 — Recursive publish changed-since intersection round

Status: complete

### Delivered

- Matched native recursive dry-run selector intersections for trailing changed-since constraints such as `pkg[HEAD]` and `{packages/a}[HEAD]`.
- Extended recursive selector parsing so `[ref]` is a suffix constraint rather than only a standalone selector.
- Preserved existing `[HEAD]`, `{dir}`, `pkg{dir}`, graph selector, and filter source behavior by evaluating changed-since as an additional package source fact.
- Added git-backed regressions for package identity plus changed-since and directory scope plus changed-since.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/215-publish-recursive-changed-since-selector-intersection.md`.

### Verification

- native recursive dry-run changed-since intersection probes:
  - `pnpm publish -r --dry-run --no-git-checks --filter 'pkg-a[HEAD]'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '{packages/a}[HEAD]'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, and changed-since selector intersections; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 212 — Recursive publish changed-files ignore pattern round

Status: complete

### Delivered

- Matched native recursive dry-run changed-since behavior for `--changed-files-ignore-pattern`.
- Parsed `--changed-files-ignore-pattern` and `--changed-files-ignore-pattern=value` from publish args.
- Filtered `git diff --name-only <ref>` file paths before mapping changed files to workspace package owners.
- Preserved existing `[ref]`, changed-since intersections, graph selector composition, and no-registry-write behavior.
- Added a git-backed regression proving a package with only ignored README changes is not packed while another changed package remains selected.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/216-publish-recursive-changed-files-ignore-pattern.md`.

### Verification

- native recursive dry-run changed-files ignore probes:
  - `pnpm publish -r --dry-run --no-git-checks --filter '[HEAD]' --changed-files-ignore-pattern '**/README.md'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '[HEAD]' --changed-files-ignore-pattern 'packages/a/README.md'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, and changed-files ignore patterns; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 213 — Recursive publish current-project filter round

Status: complete

### Delivered

- Matched native recursive dry-run current-project selector behavior for `--filter .`.
- Added current-package source facts to recursive filter context by resolving the original directory source to the owning workspace package.
- Preserved graph composition so `--filter ./...` expands dependencies from the current package seed.
- Added regressions for direct current-package selection and current-package dependency graph selection, both preserving the no-registry-write law.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/217-publish-recursive-current-project-filter.md`.

### Verification

- native recursive dry-run current-project probes:
  - from workspace root: `pnpm publish -r --dry-run --no-git-checks --filter .`
  - from `packages/a`: `pnpm publish -r --dry-run --no-git-checks --filter .`
  - from `packages/a`: `pnpm publish -r --dry-run --no-git-checks --filter ./...`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, and changed-files ignore patterns; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 214 — Recursive publish fail-if-no-match round

Status: complete

### Delivered

- Matched native recursive dry-run no-match exit behavior for `--fail-if-no-match`.
- Parsed `--fail-if-no-match`, `--no-fail-if-no-match`, and `--fail-if-no-match=false` from publish args.
- Preserved the existing native no-match message while changing only event state and exit code when the flag is true.
- Preserved no-registry-write behavior: no package packing, tarball reading, or publish call occurs on no-match.
- Added a regression proving no-match with `--fail-if-no-match` resolves failed and exits `1`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/218-publish-recursive-fail-if-no-match.md`.

### Verification

- native recursive dry-run no-match probes:
  - `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg`
  - `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg --fail-if-no-match`
  - `pnpm publish -r --dry-run --no-git-checks --filter missing-pkg --fail-if-no-match=false`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, negation, dependency graph, dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 215 — Recursive publish combined graph selector round

Status: complete

### Delivered

- Matched native recursive dry-run combined graph selector behavior for `--filter '...pkg...'`.
- Reused the existing recursive graph laws so dependencies are packed before the selected package and dependents after it.
- Preserved no-registry-write behavior: the path remains dry-run only and never calls `publishPackage()`.
- Added a regression proving `...both-mid...` packs dependency, seed, and dependent packages while excluding unrelated workspace packages.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/219-publish-recursive-combined-graph-selector.md`.

### Verification

- native recursive dry-run combined graph probe after `pnpm install --ignore-scripts`:
  - `pnpm publish -r --dry-run --filter '...native-both-mid...' --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, negation, dependency graph, dependent graph, combined dependency/dependent graph, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 216 — Recursive publish combined graph caret selector round

Status: complete

### Delivered

- Matched native recursive dry-run behavior for combined graph caret selector variants:
  - `...^pkg...`
  - `...pkg^...`
  - `...^pkg^...`
- Normalized caret markers only inside the combined `...seed...` graph selector law.
- Preserved existing non-combined exclude-self selectors such as `...^pkg` and `pkg^...`.
- Preserved no-registry-write behavior: recursive dry-run still packs locally and never calls `publishPackage()`.
- Added a regression proving all three caret variants pack dependency, seed, and dependent packages while excluding unrelated workspace packages.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/220-publish-recursive-combined-graph-caret-selectors.md`.

### Verification

- native recursive dry-run combined graph caret probes after `pnpm install --ignore-scripts`:
  - `pnpm publish -r --dry-run --filter '...^native-x-mid...' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '...native-x-mid^...' --no-git-checks`
  - `pnpm publish -r --dry-run --filter '...^native-x-mid^...' --no-git-checks`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, negation, dependency graph, dependent graph, combined dependency/dependent graph including caret seed variants, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 217 — Recursive publish current-project graph selector correction round

Status: complete

### Delivered

- Corrected recursive dry-run current-project dot graph selector behavior to match native `pnpm publish -r --dry-run`.
- Added a current-project graph selector branch before generic graph expansion for:
  - `./...`
  - `....`
  - `.^...`
  - `./^...`
  - `...^.`
  - `...^./`
- Replaced the previous over-expansion assumption: these accepted dot graph forms now resolve to the current package source fact only.
- Preserved named package graph selector behavior such as `pkg...`, `pkg^...`, `...pkg`, and `...^pkg`.
- Preserved no-registry-write behavior: recursive dry-run still packs locally and never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/221-publish-recursive-current-project-graph-overexpands.md`.

### Verification

- native recursive dry-run current-project graph probes from a package with both dependency and dependent packages:
  - `pnpm publish -r --dry-run --no-git-checks --filter './...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '....'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^.'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^./'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '.^...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter './^...'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, current-project dot graph forms, negation, dependency graph, dependent graph, combined dependency/dependent graph including caret seed variants, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 218 — Recursive publish unsupported bare graph selector round

Status: complete

### Delivered

- Matched native recursive dry-run failure behavior for unsupported bare graph selectors:
  - `...`
  - `^...`
  - `...^`
  - `......`
  - `...^...`
- Added a recursive selector validation branch before graph expansion so malformed graph selectors fail as input errors rather than no-match projections.
- Routed recursive selector errors to failed Event state and stdout diagnostics while preserving stderr for non-selector runtime errors.
- Preserved no-registry-write behavior: unsupported selectors fail before package packing, tarball reading, summary writing, or `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/222-publish-recursive-unsupported-bare-graph-selectors.md`.

### Verification

- native recursive dry-run unsupported selector probes:
  - `pnpm publish -r --dry-run --no-git-checks --filter '...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '^...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '......'`
  - `pnpm publish -r --dry-run --no-git-checks --filter '...^...'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, current-project dot graph forms, negation, dependency graph, dependent graph, combined dependency/dependent graph including caret seed variants, unsupported bare graph selector failures, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 219 — Recursive publish filter-prod unsupported selector descriptor round

Status: complete

### Delivered

- Matched native recursive dry-run unsupported selector diagnostics for `--filter-prod`.
- Threaded recursive filter edge kind into unsupported bare graph selector descriptors so `--filter-prod` reports `followProdDepsOnly:true`.
- Preserved normal `--filter` diagnostics with `followProdDepsOnly:false`.
- Preserved no-registry-write behavior: unsupported selectors still fail before package packing, tarball reading, summary writing, or `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/223-publish-recursive-filter-prod-unsupported-selector-descriptor.md`.

### Verification

- native recursive dry-run unsupported selector probes using `--filter-prod`:
  - `pnpm publish -r --dry-run --no-git-checks --filter-prod '...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter-prod '^...'`
  - `pnpm publish -r --dry-run --no-git-checks --filter-prod '...^'`
  - `pnpm publish -r --dry-run --no-git-checks --filter-prod '......'`
  - `pnpm publish -r --dry-run --no-git-checks --filter-prod '...^...'`
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity now covers exact, glob, path, current-project, current-project dot graph forms, negation, dependency graph, dependent graph, combined dependency/dependent graph including caret seed variants, unsupported bare graph selector failures including production-only diagnostics, report-summary projection, full-brace directory selectors, combined package-plus-directory selectors, changed-since selectors, production-only graph traversal, changed-since selector intersections, changed-files ignore patterns, and fail-if-no-match no-match exits; remaining advanced pnpm selector syntax still needs native probes before encoding more laws.
- Recursive dry-run stderr notice formatting covers package facts from tarball summaries, but exact byte-for-byte npm notice rendering may still drift for large sizes or npm-specific integrity truncation.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 220 — Publish dry-run bundled dependency notice round

Status: complete

### Delivered

- Matched native dry-run npm notice projection for packages with bundled dependencies.
- Extended the tarball summary source atom so bundled dependency names are derived from packed package metadata.
- Kept bundled `node_modules` files out of the normal Tarball Contents own-file projection while preserving total entry count and unpacked size from the tarball source.
- Emitted native bundled notice lines:
  - `Bundled Dependencies`
  - bundled dependency names
  - `bundled deps`
  - `bundled files`
  - `own files`
- Preserved no-registry-write behavior: this changes only dry-run notice projection and tarball summary facts.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/224-publish-dry-run-bundled-dependency-notice.md`.

### Verification

- native dry-run bundled dependency probe with `bundleDependencies: ["left-pad"]` and `nodeLinker: hoisted`
- `pnpm exec vitest run test/unit/packer.test.ts test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Recursive dry-run stderr notice formatting now covers bundled dependency sections, but exact byte-for-byte npm notice rendering may still drift for npm-specific warning preambles or unusual package-manager config warnings.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 221 — Publish dry-run stdout/stderr parity round

Status: complete

### Delivered

- Matched native single-package dry-run terminal projection for non-json publishes.
- Removed daemon-owned progress stdout from `pnpm-pub publish --dry-run`.
- Reused the tarball notice projection so npm notice details are emitted on stderr for single-package dry-run.
- Emitted native stdout success lines as `+ name@version`.
- Preserved `--json` dry-run behavior and kept `--report-summary` dry-run from writing a summary file, matching native single-package dry-run behavior.
- Preserved no-registry-write behavior: dry-run still packs or reads the source artifact only and never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/225-publish-dry-run-stdout-stderr-parity.md`.

### Verification

- native `pnpm publish --dry-run --no-git-checks` stdout/stderr probe
- native `pnpm publish --dry-run --report-summary --no-git-checks` no-summary probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package and recursive package facts, including bundled dependency sections, but exact byte-for-byte npm notice rendering may still drift for npm-specific warning preambles or unusual package-manager config warnings.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 222 — Publish dry-run json stderr notice round

Status: complete

### Delivered

- Matched native single-package `--dry-run --json` stderr projection for the publish destination notice.
- Kept stdout as pure parseable package JSON.
- Reused the same registry, tag, and access resolution law for JSON and non-JSON dry-run notice output.
- Preserved no-registry-write behavior: JSON dry-run still packs or reads the source artifact only and never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/226-publish-dry-run-json-stderr-notice.md`.

### Verification

- native `pnpm publish --dry-run --json --no-git-checks` stdout/stderr probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON and recursive package facts, including bundled dependency sections, but exact byte-for-byte npm notice rendering may still drift for npm-specific warning preambles or unusual package-manager config warnings.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 223 — Publish unknown option validation round

Status: complete

### Delivered

- Matched native publish failure behavior for unknown publish options such as `-t`.
- Added an intercept-time publish argument validation boundary before workspace auto-collection and source resolution.
- Prevented values after unknown options from being reinterpreted as tarball or directory publish sources.
- Preserved recognized publish options and their existing value forms, including `--tag`, `--access`, `--otp`, `--registry`, recursive filters, and dry-run/json booleans.
- Preserved no-registry-write safety for invalid input: unknown options fail before Git checks, packing, tarball reading, credential lookup, or `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/227-publish-unknown-option-positional-source.md`.

### Verification

- native `pnpm publish --dry-run --no-git-checks -t beta` unknown-option probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting covers single-package JSON/non-JSON and recursive package facts, including bundled dependency sections, but exact byte-for-byte npm notice rendering may still drift for npm-specific warning preambles or unusual package-manager config warnings.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 224 — Publish config namespace option parity round

Status: complete

### Delivered

- Matched native `pnpm publish` behavior for `--config.*` arguments.
- Kept unknown publish option rejection intact for normal unsupported options such as `-t`.
- Treated `--config.foo=bar` as native's warning-bearing npm config projection instead of a hard failure.
- Preserved native positional source behavior for `--config.foo bar`: the following `bar` token remains a package directory or tarball source, not an option value.
- Emitted native-style `npm warn Unknown cli config "--config.foo"` on dry-run stderr.
- Preserved no-registry-write safety: the new coverage is dry-run only and still never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/228-publish-config-option-parity.md`.

### Verification

- native `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo=bar` probe
- native `pnpm publish --dry-run --no-git-checks --registry http://registry.example/ --config.foo bar` probe
- native `pnpm publish --dry-run --no-git-checks --config.registry=http://config-registry.example/` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON, recursive package facts, bundled dependency sections, and `--config.*` warnings, but exact byte-for-byte npm notice rendering may still drift for unusual npm warning preambles.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 225 — Recursive publish positional source parity round

Status: complete

### Delivered

- Matched native recursive publish source behavior for positional package arguments.
- Froze recursive publish source resolution to the CLI `cwd`; positional directory and tarball sources now apply only to single-package publish.
- Preserved current workspace package selection when `pnpm-pub publish -r --dry-run other` is invoked from a workspace root.
- Added regression coverage proving a valid positional package directory outside the workspace package globs is not packed by recursive dry-run.
- Preserved no-registry-write safety: recursive registry publish remains blocked, and recursive dry-run still never calls `publishPackage()`.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/229-publish-recursive-positional-source-ignored.md`.

### Verification

- native `pnpm publish -r --dry-run --no-git-checks packages/a` probe
- native `pnpm publish -r --dry-run --no-git-checks other` probe
- `pnpm exec vitest run test/unit/proactive-events.test.ts`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON, recursive package facts, bundled dependency sections, and single-package `--config.*` warnings, but exact byte-for-byte npm notice rendering may still drift for unusual npm warning preambles.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 226 — Publish terminal intent local-exit round

Status: complete

### Delivered

- Matched native publish terminal intents for `--help`, `-h`, and `--version`.
- Short-circuited the CLI before daemon IPC for those informational intents.
- Delegated terminal-only publish output to native `pnpm publish`, preserving exact help/version text and exit code without auto-booting the daemon.
- Preserved the daemon publish path for real publish arguments and profile overrides.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/230-publish-help-version-daemon-side-effect.md`.

### Verification

- native `pnpm publish --help` probe
- native `pnpm publish -h` probe
- native `pnpm publish --version` probe
- `pnpm exec vitest run test/unit/cli-handshake.test.ts`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON, recursive package facts, bundled dependency sections, single-package `--config.*` warnings, and CLI terminal-only publish intents, but exact byte-for-byte npm notice rendering may still drift for unusual npm warning preambles.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.

## Milestone 227 — Publish empty profile value rejection round

Status: complete

### Delivered

- Rejected empty `--profile=` input on the explicit `start` command path.
- Rejected empty `--profile=` input on the fallback publish parser before any daemon IPC.
- Kept non-empty profile overrides working on both `start` and `publish` surfaces.
- Closed and archived `tasks/pnpm-pub-v1/.issues/closed/232-publish-empty-profile-value-rejected.md`.

### Verification

- `pnpm exec vitest run test/unit/cli-handshake.test.ts test/unit/cli-start.test.ts`
- `pnpm typecheck`
- `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`
- `git diff --check`

### Residuals

- Real recursive/workspace registry publish remains blocked and still needs a dedicated multi-package transaction atom before any registry writes are allowed.
- Recursive selector parity still requires native probes before encoding remaining advanced selector syntax.
- Dry-run stderr notice formatting now covers single-package JSON/non-JSON, recursive package facts, bundled dependency sections, single-package `--config.*` warnings, and CLI terminal-only publish intents, but exact byte-for-byte npm notice rendering may still drift for unusual npm warning preambles.
- Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
