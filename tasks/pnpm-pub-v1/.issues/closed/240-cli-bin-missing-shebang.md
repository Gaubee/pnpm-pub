---
title: "Published CLI bin is executable without a Node shebang"
state: closed
github_issue_status: closed
label: release
milestone: 240
resolution: fixed
---

## Summary

The published `pnpm-pub` bin target pointed to `dist/cli.js`, but the file began with ESM `import` statements instead of `#!/usr/bin/env node`.

## Impact

`package.json#bin` made npm and Vite+ link the file as an executable command, but the missing interpreter line caused the user's shell to parse JavaScript as `sh`. After fixing that layer, temp-prefix verification exposed the adjacent entrypoint law: Node starts the symlink path while `import.meta.url` is the real package path, so direct-entry detection also has to be symlink-aware.

## Evidence

- `package.json` declares `bin.pnpm-pub` as `./dist/cli.js`.
- The installed global file at `/Users/kzf/.vite-plus/js_runtime/node/24.18.0/lib/node_modules/pnpm-pub/dist/cli.js` had executable mode but started with `import`.
- Direct shell execution failed, while `node dist/cli.js --help` worked because Node supplied the missing interpreter.

## Resolution

Added a Node shebang to `src/cli/cli.ts`, made direct-entry detection realpath-aware for npm bin symlinks, added a build-time guard that verifies and chmods `dist/cli.js`, documented the installed-bin contract, and bumped the package to `0.1.1` for patch release.
