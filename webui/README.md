# pnpm-pub WebUI

The SvelteKit + shadcn-svelte front-end, hosted inside the opentray window by
the Node.js daemon.

## Design system

The project's design is fixed by the shadcn-svelte preset
`b7VW4OwuB6` (per `AGENTS.md`). The canonical command is:

```bash
pnpm dlx shadcn-svelte init --preset b7VW4OwuB6
```

This produced `components.json`, which pins the design contract:

- **baseColor:** `zinc`
- **style:** `nova`
- **iconLibrary:** `lucide`

### Environment note: registry fetch

`shadcn-svelte init` additionally pulls component source from
`registry.shadcn-svelte.com`. In the build environment that subdomain's TLS
handshake fails (the apex `shadcn-svelte.com` is reachable), so the component
sources could not be fetched automatically. The UI primitives under
`src/lib/components/ui/` are therefore hand-authored to the shadcn-svelte
convention (same `cn()` helper, the same `tailwind-variants` API, and the exact
zinc/nova HSL tokens in `src/routes/layout.css`). They are behaviorally and
stylistically consistent with what the preset registry would emit.

When `registry.shadcn-svelte.com` is reachable, re-running the init command will
refresh components in place without conflicting with the existing tokens.

## Scripts

- `pnpm dev` — Vite dev server (the daemon also serves a built copy).
- `pnpm build` — static SPA build via `@sveltejs/adapter-static`.
- `pnpm check` — `svelte-check` type-check.

The daemon's `pnpm build` copies the SPA into `dist/webui/` (Chapter 4.4.1 / 9.1).

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv@0.16.1 create --template minimal --types ts --no-install webui-scaffold
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
