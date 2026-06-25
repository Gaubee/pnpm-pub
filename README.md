# pnpm-pub

A desktop-level local daemon proxy + tray GUI that turns the tedious
"fetch-and-type-the-6-digit-2FA" publish flow into a single physical click, plus
NPM identity/asset management. Implements the spec under `spec/*.md`.

Architecture (Chapter 2): a **thin CLI** (`src/cli`), a **Node.js daemon hub**
(`src/daemon`), and a **SvelteKit WebUI** (`webui/`) hosted in an `opentray`
native window.

## The WebUI container: opentray + ext-webview

The WebUI is NOT opened in a plain browser in production — it is mounted inside
a real native window via [`opentray`](https://www.npmjs.com/package/opentray) and
its `@opentray/ext-webview` extension (Chapter 6.4). The canonical recipe from
the opentray README is wired up in `src/daemon/index.ts` → `tryCreateTray`:

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const tray = (await createTray({ trayId, title, icon, menu })).extend(WebviewExt);
const panel = tray.createWebviewWindow({ url: webUiUrl, width, height, style });
await panel.show();
```

The `WebviewWindowHandle` (`panel`) is what backs the `TrayHost` surface:
`panel.show()/hide()` → tray click / blur-auto-hide, `panel.setStyle({ keepOnTop })`
→ the pending-event pin, and `panel.listen('blur', ...)` → the auto-hide hook.

The window uses opentray's tray-panel glass-shell style:
- **macOS:** `frameless`, `keepOnTop`, `background: { kind: "platformMaterial", material: "hudWindow", state: "active" }`
- **Windows:** `frameless`, `keepOnTop`, `background: "mica"`, `cornerPreference: "round"`

### Native binary requirement

`createWebviewWindow` needs the platform-specific native webview binary
(`@opentray/ext-webview-darwin-arm64` etc., an optional dependency) **and** the
opentray daemon (`opentray ≥ 0.8.0`, where `createTray`/icon deserialization was
fixed). When both are present, `tryCreateTray` logs
`opentray webview window mounted` and a real native window opens.

If the native binary or broker isn't available, `tryCreateTray` logs
`opentray mount failed (...) — running headless` and the daemon still serves the
WebUI over HTTP so you can open the printed URL in a browser. To get the real
native window, consult the **`opentray` skill** (or the opentray README) for
native-runtime setup, then:

```bash
opentray daemon start   # ensure the opentray broker is running
opentray daemon health  # → "opentray daemon running" + endpoint
pnpm dev                # the daemon mounts the WebUI in a native window
```

#### Verified flow

Under opentray 0.8.0 with the native webview binary installed, the daemon log
shows the full mount:

```
opentray webview window mounted
WebUI available at http://127.0.0.1:<port>/#token=<webtoken>
[tray] pin (keepOnTop + flash)   ← TrayHost reacts to the seeded pending event
```


## Prerequisites

- [bun](https://bun.sh) ≥ 1.3 — used to run TypeScript source directly during
  development (no build step for the daemon/CLI).
- Node.js ≥ 20 (for the production bundle + `vitest`).
- pnpm ≥ 10 (`corepack enable` or `npm i -g pnpm@10`).

```bash
pnpm install
```

## Launching for development (no `dist` build)

Everything below runs the **TypeScript source directly via bun**. Only the
WebUI is pre-built once into `dist/webui/` (SvelteKit can't run from raw source).

### One-shot: boot the daemon and seed a mock profile

```bash
pnpm dev
```

This:

1. Builds the WebUI once → `dist/webui/`.
2. Boots the daemon (`src/daemon/dev.ts`) under bun.
3. Seeds a throwaway `dev-author` profile (no real NPM credentials needed).
4. Injects one demo pending publish so the Events hub has something to show.
5. Prints the WebUI URL — open it in a browser (or via `opentray` if installed):

```
┌─────────────────────────────────────────────────────────────────┐
│  pnpm-pub dev server is up.                                     │
│  WebUI:   http://127.0.0.1:<port>/#token=<webtoken>             │
│  Profile: dev-author                                            │
└─────────────────────────────────────────────────────────────────┘
```

Dev state is isolated in `PNPM_PUB_HOME` (defaults to
`$TMPDIR/pnpm-pub-dev`) so it never touches your real `~/.pnpm-pub`.

### Triggering a publish interception

In another terminal, from any directory containing a `package.json`:

```bash
PNPM_PUB_HOME=$TMPDIR/pnpm-pub-dev \
  bun run src/cli/cli.ts publish --access public
```

The CLI connects to the dev daemon and **suspends**, printing:

```
> Waiting for GUI confirmation. Please check your system tray...
```

Open the WebUI URL → the **Events** page shows the pending publish with a
**Confirm Publish** / **Reject** card (Chapter 6.2). Confirm to run the real
`pnpm pack` + registry PUT; reject to SIGINT the CLI (Chapter 6.2.2).

### Testing a real publish against a local registry

Point the dev daemon at a local Verdaccio:

```bash
# start Verdaccio (permissive, no auth)
npx verdaccio --config verdaccio-dev.yaml

# boot the daemon against it
PNPM_PUB_DEV_REGISTRY=http://127.0.0.1:4873 pnpm dev
```

Then trigger a publish as above — confirming it will pack the tarball and PUT it
to Verdaccio.

## Production build & the installed CLI

```bash
pnpm build            # WebUI → dist/webui, daemon+CLI → dist/{daemon,cli}.js
pnpm release:start    # node dist/cli.js start   (boots the daemon + tray)
pnpm release:status   # node dist/cli.js status
pnpm release:stop     # node dist/cli.js stop
```

The distributed binary is `dist/cli.js` (`bin` field); `pnpm-pub <anything>`
falls back to `pnpm publish <anything>` for muscle-memory compatibility
(Chapter 7.1.2).

## Scripts

The project uses two launch conventions:

### Development — run TypeScript source directly via `bun`

No `dist/` build step for the daemon or CLI; `bun` runs the `.ts` source. Only
the WebUI is pre-built once (SvelteKit can't run from raw source).

| Command            | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `pnpm dev`         | Build WebUI once → `dist/webui`, then boot the daemon via `bun run src/daemon/dev.ts` with a seeded mock profile. |
| `pnpm dev:webui`   | Rebuild the WebUI into `dist/webui`.                         |
| `pnpm dev:core`    | Boot only the daemon via bun (`bun run src/daemon/dev.ts`).  |
| `pnpm dev:publish` | Run the CLI from source (`bun run src/cli/cli.ts publish …`). |

### Release — run the compiled `dist/` bundle via Node

After `pnpm build`, the CLI/daemon live in `dist/` as compiled `.js`. These run
them directly (no bun, no source transpilation).

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `pnpm build`         | Full production build → `dist/{cli.js,daemon.js,prebuilds/,webui/}`. |
| `pnpm release:start` | Boot the daemon + tray from the built bundle (`node dist/cli.js start`). |
| `pnpm release:status`| Query the running daemon (`node dist/cli.js status`).        |
| `pnpm release:stop`  | Graceful shutdown (`node dist/cli.js stop`).                 |
| `pnpm release:publish`| Run the built CLI (`node dist/cli.js …`).                   |

### Testing

| Command             | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `pnpm test`         | Unit tests (`vitest`).                                       |
| `pnpm test:e2e`     | E2E interception test (mock registry; set `PNPM_PUB_E2E_REGISTRY` for Verdaccio). |
| `pnpm test:e2e:docker` | Boot a Dockerized Verdaccio, run E2E, tear down.          |
| `pnpm typecheck`    | `tsc --noEmit`.                                              |

## Environment variables

| Var                       | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------ |
| `PNPM_PUB_HOME`           | Override the app home (`~/.pnpm-pub`). Used by `pnpm dev` so a spawned CLI agrees with the daemon on the IPC socket path. |
| `PNPM_PUB_DEV_REGISTRY`   | Registry the dev-seeded profile targets (default npmjs.org). |
| `PNPM_PUB_DEV_TOKEN`      | Token for the dev mock profile.                              |
| `PNPM_PUB_DEV_TOTP`       | TOTP secret for the dev mock profile.                        |
| `PNPM_PUB_DEV_NO_TRAY`    | `1` to skip the opentray host (headless).                    |
| `PNPM_PUB_DAEMON_ENTRY`   | Daemon entry the CLI spawns (dev: `src/daemon/main.ts`).     |
| `PNPM_PUB_E2E_REGISTRY`   | Real registry URL for the E2E test (e.g. a local Verdaccio). |
