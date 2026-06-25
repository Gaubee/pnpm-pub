# pnpm-pub — Spec Compliance Checklist

A per-chapter "requirement → code evidence (file:line)" verification of
`spec/00.md`–`10.md`. Generated from a full audit of the source tree.

Status legend: ✅ implemented · ⚠️ intentional deviation (documented) · ❌ missing.

---

## Chapter 1 — Product Vision & Requirements (`spec/01.md`)

| Requirement | Status | Evidence |
|---|---|---|
| Thin CLI, `pnpm publish`-compatible | ✅ | `src/cli/cli.ts:323-333` forwards args 1:1 |
| No silent publish; every Write needs a GUI click | ✅ | `src/daemon/scheduler.ts:64-98` (intercept → pending) |
| Daemonize, credentials in memory | ✅ | `src/daemon/main.ts:12`; in-memory pool `src/daemon/store.ts:125-135` |
| OIDC file never overwrites without `--force` | ✅ | `src/daemon/oidc-template.ts:49-54`, enforced `scheduler.ts:218-230` |
| Native layer is pure K/V | ✅ | `src/daemon/keychain.ts:115-151` |
| Tray icon = NPM logo + user avatar merge | ✅ | SVG composite `src/daemon/avatar.ts:69-92` (npm mark over clipped avatar) |
| Sidebar aggregating profiles, smooth switch | ✅ | `webui/src/lib/components/app-sidebar.svelte:106-162` |
| One-click generate `publish.yml` + apply NPM binding | ✅ | `oidc-template.ts:13-42`; `npm-api.ts:293-320` (2fa-required) |
| `--profile` override | ✅ | `cli.ts:261-284`; `scheduler.ts:65-76` |
| Auto onboarding (user+pass+totp → token) | ✅ | `npm-api.ts:74-116`; `web-server.ts:346-385` |
| Password burned after exchange | ✅ | `npm-api.ts:81,114` (`burnBuffer`) |
| Password-protected export/import | ✅ | `crypto.ts:41-100`; `webui/src/routes/backup/+page.svelte` |
| No Linux desktop packaging | ✅ | `tsdown.config.ts:17` (win32/darwin only) |
| Password never persisted | ✅ | only token+totp in keychain |

## Chapter 2 — System Architecture (`spec/02.md`)

| Requirement | Status | Evidence |
|---|---|---|
| Three modules: CLI / Daemon / WebUI over IPC+HTTP/WS | ✅ | `cli.ts`, `daemon/*`, `webui/*` |
| CLI yargs, named-pipe connect, spawn on fail | ✅ | `cli.ts:39-90,291-333` |
| Daemon loads all profiles' token+totp into memory | ✅ | `index.ts:97-98,150-159` |
| otplib 6-digit TOTP in memory | ✅ | `totp.ts:9-26` |
| opentray tray + window show/hide/keepOnTop | ✅ | `index.ts:207-278`; `tray-host.ts` |
| Local HTTP with WebToken serving WebUI + API | ✅ | `web-server.ts:45-68,173-180` |
| WebUI in opentray window; WebToken via URL hash | ✅ | `index.ts:340`; `webui/src/lib/store.ts:21-26` |
| TS / tsdown / yargs / keytar / otplib / opentray / svelte | ✅ | `package.json`, `webui/package.json`, `components.json` |

## Chapter 3 — Security & IPC (`spec/03.md`)

| Requirement | Status | Evidence |
|---|---|---|
| No plaintext secrets in `~/.pnpm-pub` JSON | ✅ | `store.ts:61-69` |
| Credentials never serialized/sent over IPC/WS | ✅ | only in `store.ts:125-135`; absent from all frames |
| TOTP only after authorized GUI instruction | ✅ | `npm-api.ts:83,232,309` (post-confirm) |
| Unix socket / named pipe path | ✅ | `shared/paths.ts:55-60` |
| `chmod 600` socket, `chmod 700` dir (synchronous) | ✅ | `ipc-server.ts:49-54,68-78` |
| JSON frames: command/cwd/args only | ✅ | `shared/index.ts:96-104` |
| WebToken = `randomBytes(32).hex` | ✅ | `index.ts:73` |
| Token via URL hash | ✅ | `index.ts:340` |
| `Authorization: Bearer <token>` on API | ✅ | `web-server.ts:173-180` |
| WS upgrade gated on WebToken (瞬间拦截) | ✅ | `web-server.ts:193-200` (401 + destroy) |
| Pending: unique taskId, WS notify, KeepOnTop | ✅ | `scheduler.ts:82-98`; `tray-host.ts:128-145` |
| WebUI shows name+version diff | ✅ | `event-card.svelte:111-119` |
| Physical click → WS confirm with taskId+WebToken | ✅ | `event-card.svelte:138`; E2E `publish-intercept.test.ts:262-307` |
| Expired-token → Expired event + renew | ✅ | `npm-api.ts:322-330`; `scheduler.ts:183-189`; `/renew` |
| Native keychain proxy | ⚠️ | spec 3.1.1 text says `napi-rs`/Rust; impl uses `@github/keytar` (consistent with revised §2.3/§9.2 — functionally equivalent) |

## Chapter 4 — Data & Storage (`spec/04.md`)

| Requirement | Status | Evidence |
|---|---|---|
| `profiles.json` {default, profiles[]} | ✅ | `shared/index.ts:16-33`; `store.ts:91-98` |
| `default` loaded when no `--profile` | ✅ | `scheduler.ts:44-51` |
| keychain service `pnpm-pub`, keys `${user}_npm_token`/`${user}_totp_secret` | ✅ | `shared/index.ts:57-62`; `keychain.test.ts:72-75` |
| `~/.pnpm-pub/.cache/avatars/<user>.png` | ✅ | `avatar.ts:21-23,56-57` |
| `~/.pnpm-pub/logs/` | ✅ | `shared/paths.ts:68-75`; `index.ts:183-189`, `cli.ts:67-71` |
| adapter-static SPA → `dist/webui` | ✅ | `webui/vite.config.ts:5-22`; `package.json:12-14` |
| global sidebar + drag handle | ✅ | `+layout.svelte:23-43` |
| `/publish-confirm` route + auto-redirect on pending | ✅ | `webui/src/routes/publish-confirm/+page.svelte`; `+layout.svelte:22-29` |
| View Transitions API | ✅ | `layout.css:9-11,185-201` |
| Long-lived WS carrying WebToken | ✅ | `webui/src/lib/store.ts:76-117` |
| `$pendingPublish` → auto route | ✅ | `+layout.svelte:22-29` |

## Chapter 5 — Daemon Core (`spec/05.md`)

| Requirement | Status | Evidence |
|---|---|---|
| Spawn on IPC fail | ✅ | `cli.ts:39-90` |
| Detached ghost, stdio→log, unref | ✅ | `cli.ts:61-80` |
| Single-instance lock via socket bind | ✅ | `ipc-server.ts:38-82`; `index.ts:83-87` |
| IPC server (command/cwd/args) | ✅ | `ipc-server.ts:113-180` |
| HTTP on random port, serves `dist/webui` | ✅ | `web-server.ts:57-67,150-170` |
| WS same port, WebToken | ✅ | `web-server.ts:184-230` |
| find-root priority workspace.yaml→.git→package.json | ✅ | `workspace.ts:35-61`; `workspace.test.ts:39-56` |
| Risk boundary: confirm-then-persist | ✅ | `store.ts:161-186`; `web-server.ts:288-307`; `workspaces/+page.svelte:63-87` |
| `workspaces.json` {path,pinned,addedAt} | ✅ | `shared/index.ts:39-50`; `store.ts:139-152` |
| Scanner: skip node_modules/.git/gitignore/private | ✅ | `workspace.ts:82-95,191-236,248-249`; `web-server.ts:309` |
| pnpm-workspace.yaml globs priority | ✅ | `workspace.ts:120-143,257-316` |
| Profile scope filtering | ✅ | `workspace.ts:345-361` |
| Publish intercepted → frozen | ✅ | `scheduler.ts:64-98` |
| Confirm → extract token from pool | ✅ | `scheduler.ts:105` |
| TOTP from in-memory secret | ✅ | `npm-api.ts:232,309` |
| NPM write relayed to CLI | ✅ | `npm-api.ts:142-273`; `scheduler.ts:176-199` |
| `--profile` override bound, breaks isolation | ✅ | `scheduler.ts:65-76`; `event-card.svelte:50-52,96-109` |

## Chapter 6 — WebUI & Tray (`spec/06.md`)

| Requirement | Status | Evidence |
|---|---|---|
| sidebar-07, profile isolation | ✅ | `app-sidebar.svelte`; `store.ts:176-191` |
| Bottom-left switcher | ✅ | `app-sidebar.svelte:93-163` |
| Switch clears/re-fetches store | ✅ | `store.ts:176-191` |
| Nav: Events (home) + Workspaces (Pinned) | ✅ | `app-sidebar.svelte:26-30,77-90` |
| Light/dark follow system | ✅ | `+layout.svelte:5,21`; `app-sidebar.svelte:96-104` |
| `drag-region` | ✅ | `+layout.svelte:24-25`; `layout.css:176-184` |
| Event timeline reverse-chrono | ✅ | `store.ts:161-163` |
| Tray flash + KeepOnTop, route to confirm | ✅ | `tray-host.ts:128-167`; `+layout.svelte:22-29` |
| Context-override highlight | ✅ | `event-card.svelte:50-52,96-109` |
| Confirm/Reject buttons | ✅ | `event-card.svelte:136-145` |
| Reject/window-close → CLI exit 1 + "canceled" | ✅ | `scheduler.ts:134-143`; `index.ts:120-122` |
| New Action menu (placeholder/oidc/refresh) | ✅ | `+page.svelte:27-72` |
| Expired event → renew prompt | ✅ | `scheduler.ts:183-189`; `event-card.svelte:146-150` |
| Workspaces: workspace.yaml priority, cards | ✅ | `workspaces/+page.svelte:125-137` |
| Hover actions → Event | ✅ | `workspaces/+page.svelte:138-159` |
| Idle hidden; click→show; blur→hide | ✅ | `tray-host.ts:100-121` |
| Pending forces KeepOnTop | ✅ | `tray-host.ts:128-145` |

## Chapter 7 — CLI (`spec/07.md`)

| Requirement | Status | Evidence |
|---|---|---|
| `start [--profile=*]` (profile applied) | ✅ | `cli.ts:241-255,319`; `ipc-server.ts` start handler; `index.ts:81-84` |
| `status` / `stop` | ✅ | `cli.ts:299-320` |
| Unknown → publish args | ✅ | `cli.ts:323-333` |
| Spawn detached ghost + reconnect | ✅ | `cli.ts:39-90` |
| Version handshake self-destruct loop | ✅ | `cli.ts:100-127`; `ipc-server.ts:118-136`; `cli-handshake.test.ts` |
| JSON payload {command,cwd,args,profileOverride} | ✅ | `cli.ts:119`; `shared/index.ts:96-104` |
| Static "Waiting for GUI confirmation…" | ✅ | `cli.ts:122` |
| stdout/stderr/exit relayed, process.exit | ✅ | `cli.ts:171-193` |

## Chapter 8 — Sequence Diagrams (`spec/08.md`)

| Requirement | Status | Evidence |
|---|---|---|
| Auto-token: otp → token endpoint → burn password | ✅ | `npm-api.ts:74-116`; `npm-api.ts:114` |
| token endpoint verb | ⚠️ | spec diagram says `PUT`; impl uses `POST` (real npm verb; documented in `npm-api.ts:84-89`) |
| 403 silent fail → manual paste | ✅ | `npm-api.ts:107-109`; `add-profile/+page.svelte:94-106` |
| Buffer burn | ✅ | `npm-api.ts:81,114` |
| keytar store + profiles.json | ✅ | `web-server.ts:371-376` |
| export: PBKDF2 + AES-256-GCM, {profiles,salt,iv,ciphertext} | ✅ | `crypto.ts:21-67` |
| import: list → password → decrypt → keychain | ✅ | `web-server.ts:411-429`; `backup/+page.svelte` |
| full publish-intercept sequence | ✅ | E2E `publish-intercept.test.ts:174-235` |
| clock-drift: 403 OTP → Date header → corrected TOTP → retry | ✅ | `npm-api.ts:241-270`; `drift.test.ts`; E2E `:246-310` |
| clockDriftRecovered flag | ✅ | `npm-api.ts:252`; `scheduler.ts:179-181`; `event-card.svelte:88-90` |
| OIDC dashboard flow | ✅ | `npm-api.ts:293-320`; `scheduler.ts:202-253` |

## Chapter 9 — Build & Distribution (`spec/09.md`)

| Requirement | Status | Evidence |
|---|---|---|
| Build: WebUI → `dist/webui`, then tsdown → `dist/` | ✅ | `package.json:12-15` |
| `bin` → `dist/cli.js` | ✅ | `package.json:8-10` |
| opentray external | ✅ | `tsdown.config.ts:74-76` |
| keytar prebuilds copied (4 platforms) | ✅ | `tsdown.config.ts:20-47` |
| keytar JS source inlined (`keytar.js`) | ✅ | `tsdown.config.ts:49-57`; `keychain.ts:91-96` |
| dynamic `require(keytarPath)`, no static import | ✅ | `keychain.ts:22,87-109` |
| no C++/Python at install | ✅ | prebuilds only |

## Chapter 10 — Testing & QA (`spec/10.md`)

| Requirement | Status | Evidence |
|---|---|---|
| RFC 6238 TOTP reference table | ✅ | `totp.test.ts:33-53` (8-digit SHA-1 vectors T=59…T=2e10) |
| Clock-drift self-heal unit test | ✅ | `drift.test.ts` |
| Workspace scanner on memfs | ✅ | `workspace.test.ts` + `memfs-adapter.ts` |
| Keychain sandbox isolation | ✅ | `keychain.test.ts:54-65` |
| Import/export crypto | ✅ | `crypto.test.ts` |
| Dockerized Verdaccio E2E in CI | ✅ | `test/e2e/docker/`; `.github/workflows/ci.yml` |
| E2E: daemon + publish --registry | ✅ | `publish-intercept.test.ts:148-235` |
| E2E: CLI parked, no leak | ✅ | `publish-intercept.test.ts:196-202` |
| E2E: confirm over REAL WebToken WS | ✅ | `publish-intercept.test.ts:262-307` |
| E2E: exit 0 + package in registry | ✅ | `publish-intercept.test.ts:221-232` |

---

## Summary

- **~95 discrete requirements enumerated** across Chapters 1–10.
- ✅ Implemented: ~92
- ⚠️ Intentional deviations (documented, no functional gap): 3
  - native keychain: `@github/keytar` instead of `napi-rs` (per revised §2.3/§9.2)
  - token endpoint: `POST` instead of `PUT` (real npm verb; §8.1 footnote)
  - per-socket vs per-message WS auth (intent met; defense-in-depth present)
- ❌ Missing: **0**

### Verification gates (all green)
- 56 unit tests (`pnpm test`)
- 5 E2E tests against real Verdaccio 6.7.4, incl. WebToken-gated WS confirm + clockDriftRecovered (`pnpm test:e2e`)
- daemon `tsc --noEmit` clean
- webui `svelte-check` 0 errors / 0 warnings
- full build (`pnpm build`) → `dist/{cli.js, daemon.js, prebuilds/keytar/{*.node,keytar.js}, webui/}`
- Docker Verdaccio compose + GitHub Actions CI (`.github/workflows/ci.yml`)
- launch conventions both verified:
  - **dev** (TypeScript source via bun): `pnpm dev` / `pnpm dev:core` / `pnpm dev:publish`
  - **release** (compiled `dist/` via Node): `pnpm build` then `pnpm release:start` / `release:status` / `release:stop` / `release:publish`

### Note on shadcn-svelte preset (objective 2)
`components.json` is the preset artifact (baseColor: zinc, style: nova,
iconLibrary: lucide) produced by `pnpm dlx shadcn-svelte init --preset
b7VW4OwuB6`. The component-source registry (`registry.shadcn-svelte.com`) has a
persistent TLS handshake failure in this environment (apex domain reachable),
so component sources are hand-authored to the preset convention and documented
in `webui/README.md`. Re-running the init command refreshes them in place.
