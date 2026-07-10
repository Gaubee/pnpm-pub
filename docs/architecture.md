# Architecture

pnpm-pub separates the source of an action from its review projection:

```text
CLI publish or OIDC request
              |
              v
      local daemon and action record
              |
              v
 native tray WebUI review projection
              |
     explicit approval or rejection
              |
              v
 npm registry operation and CLI result
```

## Runtime Atoms

- **CLI (`src/cli`)** accepts publish-compatible arguments, creates local requests, and remains attached until an action resolves.
- **Daemon (`src/daemon`)** owns local state, credentials, action scheduling, npm communication, and the local authenticated transport.
- **App update service (`src/daemon/app-update.ts`)** owns npm latest-version checks, the persisted `~/.pnpm-pub/update.json` cadence record, and global package-manager ownership verification.
- **WebUI (`webui`)** is the SvelteKit review and management projection. It is hosted in an OpenTray native WebView window on supported desktop runtimes.
- **Tray host (`src/daemon/tray-host.ts`)** owns native window visibility and tray integration, while the WebUI owns its visual transition timeline.

## Native Window

On supported macOS and Windows hosts, pnpm-pub mounts the WebUI in an OpenTray native window through `@opentray/ext-webview`. If a native runtime is unavailable during development, the daemon still exposes the local WebUI URL for browser use.

The tray window is a projection, not the authority for the action itself. A publish or trust update only becomes externally visible after an explicit confirmation reaches the daemon.

## Credential Boundary

Npm credentials and TOTP secrets are stored through native credential services: macOS Keychain or Windows Credential Manager. The daemon reads these secrets at the narrow boundary where they are required for an npm operation; the WebUI does not become a persistent credential store.

## State Ownership

- Persisted profiles, preferences, workspace records, and event history are daemon-owned facts.
- Pending action status is daemon-owned until resolution.
- Labels, countdowns, badges, rendered event cards, and window animation are WebUI projections.
- Update availability is daemon-owned truth; About, Settings navigation, and the titlebar badge are projections of one `app-update` frame.

This separation keeps a hidden or reloaded window from changing an action's meaning or its source of authorization.

## Application Updates

The daemon evaluates update eligibility every minute. A successful npm `latest` check is cached for 24 hours; a failed check retries after one hour. A manual check resets the same schedule. The cache contains timestamps, version facts, owner resolution, and safe error text only.

An available update never installs silently. The About tab starts installation only after a physical user action and only when pnpm-pub's global installation root is verified against one of npm, pnpm, Yarn Classic, Bun, Volta, or Vite+ (`vp`). Corepack and ambiguous local links are launchers or unverified sources, not update authorities. A detached worker uses fixed argv, validates the new installed version, then restarts the daemon.
