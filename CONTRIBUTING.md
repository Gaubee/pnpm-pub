# Contributing to pnpm-pub

Thank you for contributing. pnpm-pub coordinates terminal requests, local state, native credential boundaries, a tray window, and npm writes, so changes must preserve clear sources of action.

## Start Here

1. Read the [product README](README.md) and [architecture guide](docs/architecture.md).
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev` to use the live WebUI and source daemon.
4. Keep your test state isolated with `PNPM_PUB_HOME` when a change touches profiles, credentials, events, or daemon lifecycle.

## Contribution Principles

- Treat persisted records, protocol events, and explicit approvals as source facts; UI labels, cards, badges, and animations are projections.
- Keep product atoms separated through typed protocol boundaries. Do not make a UI component directly own daemon or npm side effects.
- Preserve the review boundary: registry mutations need a traceable action and authorization source.
- Use strong TypeScript types. Do not introduce `any`, `as any`, or `@ts-nocheck` except at a narrowly documented third-party boundary.

## Verification

Run the focused tests for the behavior you changed, then at minimum:

```bash
pnpm typecheck
pnpm --dir webui check
git diff --check
```

For changes across daemon, protocol, or native-window boundaries, run the relevant unit and integration tests as well. For UI behavior, verify the actual route in a browser or native WebView where practical.

## Commit Scope

Keep commits atomic and reversible. Do not combine specification work, implementation, and archive/cleanup material in one commit. Describe the user or system behavior changed, not just the files edited.
