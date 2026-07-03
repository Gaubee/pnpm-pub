import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execa, type ResultPromise } from "execa";
import httpProxy from "http-proxy";
import http from "node:http";
import net from "node:net";
import path from "node:path";

// Anchor module resolution at the repo root so `tsx` (a root devDep, not in
// webui) is reachable under pnpm's isolated layout.
const rootRequire = createRequire(path.resolve(repoRoot(), "package.json"));
const tsxLoader = rootRequire.resolve("tsx");

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
    // Boot the daemon alongside the Vite dev server and proxy daemon API/WS
    // traffic to it. The proxy is wired in `configureServer` (not statically in
    // `server.proxy`) because the daemon port is only known once the plugin
    // allocates it — `server.proxy` is read at config-load time, before the
    // plugin runs, so it would resolve to undefined and disable the proxy.
    pnpmPubDaemonDev(),
  ]),
});

/**
 * Vite dev plugin: spawn the daemon (`src/daemon/dev.ts` via tsx) and tie its
 * lifecycle to the Vite dev server, plus proxy the daemon's `/api`, `/__token`
 * and `/ws/rpc` endpoints to it.
 *
 * The proxy is wired here (in `configureServer`, once the port is known) rather
 * than via the static `server.proxy` block because `server.proxy` is evaluated
 * at config-load time — before this plugin has allocated a daemon port, so it
 * would resolve to undefined and disable the proxy entirely (every `/api` and
 * `/ws/rpc` request then fell through to SvelteKit's 404 page). Wiring an
 * http-proxy middleware + upgrade handler here runs at request time, after the
 * port is set.
 */
function pnpmPubDaemonDev(): Plugin {
  return {
    name: "pnpm-pub/daemon-dev",
    apply: "serve",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      // Respect an explicit port if the caller set one; otherwise allocate.
      const portPromise = process.env.PNPM_PUB_DEV_DAEMON_PORT
        ? Promise.resolve(Number(process.env.PNPM_PUB_DEV_DAEMON_PORT))
        : allocateRandomPort();
      let daemon: ResultPromise | null = null;
      let shuttingDown = false;

      // Shut down the whole dev session (Vite included). Called when the daemon
      // exits — without it the UI has nothing to talk to, so there's no point
      // keeping Vite alive. Mirrors the old src/dev.ts supervisor contract.
      const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.error(`[dev] ${reason}; stopping dev session`);
        await server.close().catch(() => {});
        process.exit(0);
      };

      const spawnDaemon = (port: number, webuiUrl: string): void => {
        // Run the daemon via node + tsx's ESM loader (no `pnpm exec` wrapper
        // chain). execa handles everything we used to hand-roll:
        //   - cleanup (default): the daemon is killed when this process exits,
        //     so it can never be orphaned — no SIGKILL exit handler needed.
        //   - signal forwarding: SIGINT/SIGTERM to this process propagate to
        //     the daemon, so no ancestor-PID / supervisor-watch gymnastics.
        const entry = path.resolve(repoRoot(), "src/daemon/dev.ts");
        daemon = execa(process.execPath, ["--import", tsxLoader, entry], {
          stdio: "inherit",
          env: {
            ...process.env,
            PNPM_PUB_DEV_DAEMON_PORT: String(port),
            // webviewUrl carries the token placeholder the daemon substitutes
            // with its real webToken before printing the banner.
            PNPM_PUB_DEV_WEBVIEW_URL: webuiUrl,
            // Let the daemon watch this (the Vite) process for orphan cleanup.
            PNPM_PUB_DEV_SUPERVISOR_PID: String(process.pid),
          },
        });
        daemon.on("exit", (code, signal) => {
          console.error(
            `[dev] daemon child exit: code=${String(code)} signal=${String(signal)}`,
          );
          void shutdown(`daemon exited (code=${String(code)} signal=${String(signal)})`);
        });
      };

      void portPromise.then((port) => {
        process.env.PNPM_PUB_DEV_DAEMON_PORT = String(port);
        // Wire the daemon proxy now that the port is known. http-proxy serves
        // both regular HTTP (via a connect middleware) and WebSocket upgrades
        // (via the 'upgrade' handler).
        const target = `http://127.0.0.1:${port}`;
        const proxy = httpProxy.createProxyServer({ target, ws: true });
        const isDaemonRoute = (url: string): boolean =>
          url.startsWith("/api/") || url.startsWith("/__token") || url.startsWith("/ws/");
        const handler = (
          req: http.IncomingMessage,
          res: http.ServerResponse,
          next: () => void,
        ): void => {
          if (isDaemonRoute(req.url ?? "")) proxy.web(req, res, undefined, next);
          else next();
        };
        // Install at the FRONT of the connect stack so daemon routes are served
        // before SvelteKit's own middleware can 404 them. `server.middlewares`
        // is a Connect instance whose `.stack` is the ordered layer list.
        (server.middlewares as unknown as { stack: unknown[] }).stack.unshift(
          { route: "", handle: handler },
        );
        httpServer.on("upgrade", (req, socket, head) => {
          if (isDaemonRoute(req.url ?? "")) proxy.ws(req, socket, head);
        });
        // Spawn the daemon IMMEDIATELY (in parallel with Vite's own boot) rather
        // than waiting for Vite's HTTP server to finish listening. The webui port
        // is pinned to 5173 (see the `dev` script) so the banner URL is known up
        // front.
        spawnDaemon(port, "http://127.0.0.1:5173/#token=__PNPM_PUB_WEB_TOKEN__");
      });
    },
  };
}

function repoRoot(): string {
  // webui/ is one level below the repo root.
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
}

function allocateRandomPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}
