# Development

This guide is for contributors working from source. End users should follow the [main README](../README.md) instead.

## Prerequisites

- Bun 1.3+ for build helper scripts.
- Node.js 24+ for the production bundle, `tsx`, and tests.
- pnpm 10+.

```bash
pnpm install
```

## Run the Local Runtime

```bash
pnpm dev
```

This starts Vite for the WebUI on a random local port, starts the daemon from `src/daemon/dev.ts`, proxies authenticated WebUI traffic to it, and opens OpenTray DevTools when a supported native WebView runtime is mounted. Development state is isolated under `$TMPDIR/pnpm-pub-dev` by default, so it does not touch your real `~/.pnpm-pub` state.

To drive a source publish request from another terminal:

```bash
PNPM_PUB_HOME=$TMPDIR/pnpm-pub-dev \
  bun run src/cli/cli.ts publish --access public
```

Use `PNPM_PUB_DEV_NO_TRAY=1` to run without the native tray host.

## Build and Verify

```bash
pnpm build
pnpm typecheck
pnpm --dir webui check
pnpm test
pnpm test:e2e
```

`pnpm test` runs the unit project first and the browser project second. The lanes are intentionally sequential so daemon sandboxes and browser automation do not compete for process-global resources. Registry E2E remains a separate command.

`pnpm test:e2e:docker` launches a local Verdaccio registry for an end-to-end publish path when Docker is available.

## Environment Variables

| Variable                | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `PNPM_PUB_HOME`         | Overrides the app home; use it to isolate local test state. |
| `PNPM_PUB_DEV_NO_TRAY`  | Set to `1` to skip native tray mounting in development.     |
| `PNPM_PUB_DAEMON_ENTRY` | Overrides the daemon entry point used by the CLI.           |
| `PNPM_PUB_E2E_REGISTRY` | Provides a real registry URL for end-to-end tests.          |

## Local Registry Exercise

For a manual publish against Verdaccio:

```bash
npx verdaccio --config verdaccio-dev.yaml
pnpm dev
```

Add a profile that points at `http://127.0.0.1:4873`, then create and approve a publish action as above.
