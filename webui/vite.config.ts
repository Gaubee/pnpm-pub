import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import { fileURLToPath } from "node:url";
import type { ServerOptions } from "vite-plus";

// Chapter 4.4.1: adapter-static compiles the SvelteKit app to a pure SPA whose
// output the daemon serves from dist/webui.
export default defineConfig({
  resolve: {
    alias: {
      // Allow the webui to import the shared Zod schemas from the repo root
      // (src/shared/schemas.ts is pure Zod — no Node APIs).
      $shared: fileURLToPath(new URL("../src/shared/", import.meta.url)),
    },
  },
  plugins: lazyPlugins(() => [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
      },

      adapter: adapter({
        pages: "build",
        assets: "build",
        fallback: "index.html",
        precompress: false,
        strict: false,
      }),
    }),
  ]),
  server: {
    proxy: devDaemonProxy(),
  },
});

function devDaemonProxy(): ServerOptions["proxy"] {
  const port = process.env.PNPM_PUB_DEV_DAEMON_PORT;
  if (!port) return undefined;
  const target = `http://127.0.0.1:${port}`;
  return {
    "/api": { target },
    "/__token": { target },
    "/ws": { target, ws: true },
  };
}
