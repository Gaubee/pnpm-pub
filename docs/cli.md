# CLI Guide

`pnpm-pub` is a publish-compatible CLI with an explicit local daemon and tray window. The desktop UI is the review surface; the terminal command remains the source that requested the work.

## Publish Interception

Run a publish request from the package directory:

```bash
pnpm-pub publish --access public
```

The CLI starts the local daemon when necessary, creates a pending action, and waits for a decision in the tray window. Approval runs the package and registry work; rejection cancels the waiting CLI process.

Except for the explicit commands below, arguments are forwarded as a publish request. This keeps ordinary pnpm publish flags available without a second command language.

## Lifecycle Commands

```bash
pnpm-pub start [--profile <name>]
pnpm-pub status
pnpm-pub stop
pnpm-pub daemon <start|status|stop>
pnpm-pub version
pnpm-pub help
```

`start` opens the tray window and can select an existing profile. `status` reports the daemon and active profile; `stop` shuts it down gracefully.

## Trusted Publishing

`oidc` creates pending Trusted Publishing actions. It does not mutate npm trust configuration directly; approve the generated action in the tray window first.

```bash
pnpm-pub oidc
pnpm-pub oidc --repo owner/repo --file publish.yml --env npm-release
pnpm-pub oidc --recursive --repo owner/repo --file publish.yml
pnpm-pub oidc @scope/a @scope/b --repo owner/repo --file publish.yml
pnpm-pub oidc --remove @scope/pkg
```

Supported providers are GitHub Actions, GitLab CI, and CircleCI. Use `pnpm-pub oidc --help` for the complete provider-specific argument reference.
