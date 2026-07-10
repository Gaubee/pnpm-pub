# Releasing

Stable `pnpm-pub` releases are published by GitHub Actions through npm Trusted Publishing. The workflow does not use a long-lived npm token.

## Release Contract

```text
package.json version
        |
        v
GitHub Release tag v<version>
        |
        v
release.yml verification + npm OIDC
        |
        v
npm registry version
```

The trusted publisher coordinates are fixed:

- Package: `pnpm-pub`
- Repository: `Gaubee/pnpm-pub`
- Workflow: `release.yml`
- GitHub Environment: `npm-release`

## Publish a Version

1. Update `package.json` to the intended version and update user-facing documentation where behavior changed.
2. Run the focused tests plus `pnpm typecheck`, `pnpm --dir webui check`, `pnpm --filter ./webui i18n:check:strict`, `pnpm build`, and `npm pack --dry-run`.
3. Merge or push the release commit to `main` and wait for CI to pass.
4. Publish a GitHub Release whose tag is exactly `v<package.json version>`.
5. Follow the `Release` workflow until it verifies the same version from the npm registry.

Do not run `npm publish` locally. A workflow rerun is safe: it skips the publish mutation when the exact version already exists and still verifies registry truth.

The current workflow accepts stable semantic versions only. Prerelease channels require an explicit dist-tag contract before they can be enabled.

## Trusted Publisher Setup

The workflow file must exist on GitHub before configuring npm. An authenticated maintainer can establish the trust relationship with:

```bash
npm trust github pnpm-pub \
  --repo Gaubee/pnpm-pub \
  --file release.yml \
  --env npm-release \
  --allow-publish \
  --allow-stage-publish \
  --yes
```

List the current npm trust configuration before changing it. The workflow identity above is part of the authorization boundary, so filename, repository, and environment changes must be coordinated with npm before the next release.
