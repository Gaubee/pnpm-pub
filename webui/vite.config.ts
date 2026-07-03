import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
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
    // Boot the daemon alongside the Vite dev server so a single `vp dev webui`
    // (run from the repo root) brings up the full UI + daemon experience that
    // the former src/dev.ts supervisor owned. The daemon runs as a SEPARATE
    // `tsx` child process (not in-process) to preserve the node:http WebSocket
    // upgrade semantics the daemon depends on.
    pnpmPubDaemonDev(),
  ]),
  server: {
    proxy: devDaemonProxy(),
  },
});

/**
 * Vite dev plugin: spawn the daemon (`src/daemon/dev.ts` via tsx) and tie its
 * lifecycle to the Vite dev server.
 *
 * The plugin allocates a random daemon port and writes it to
 * `PNPM_PUB_DEV_DAEMON_PORT` BEFORE the `server.proxy` resolves (proxies are
 * evaluated lazily per-request, so setting the env var in `configureServer`
 * is in time for the first request). The existing `devDaemonProxy()` reads
 * that same env var, so the proxy wires itself up automatically.
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
      let daemon: ChildProcess | null = null;

      const stop = (signal: NodeJS.Signals = "SIGINT"): void => {
        if (!daemon) return;
        const child = daemon;
        daemon = null;
        if (child.killed) return;
        try {
          child.kill(signal);
        } catch {
          /* best effort */
        }
        // Escalate to SIGKILL after a grace window.
        const force = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, 2_000);
        force.unref?.();
      };

      const spawnDaemon = (port: number, webuiUrl: string): void => {
        daemon = spawn("pnpm", ["exec", "tsx", path.resolve(repoRoot(), "src/daemon/dev.ts")], {
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
        daemon.once("exit", (code, signal) => {
          console.error(
            `[dev] daemon child exit: code=${String(code)} signal=${String(signal)}`,
          );
        });
      };

      void portPromise.then((port) => {
        // Feed the proxy the agreed port (proxies read the env var lazily).
        process.env.PNPM_PUB_DEV_DAEMON_PORT = String(port);
        // The webui URL needs the Vite port, which is only known once the HTTP
        // server is listening — defer the spawn until then.
        const launch = (): void => {
          const addr = httpServer.address();
          const webuiPort = typeof addr === "object" && addr ? addr.port : 0;
          spawnDaemon(port, `http://127.0.0.1:${webuiPort}/#token=__PNPM_PUB_WEB_TOKEN__`);
        };
        if (httpServer.listening) launch();
        else httpServer.once("listening", launch);
      });

      // Tear down the daemon when the Vite server closes (Ctrl-C / :q).
      httpServer.on("close", () => stop("SIGINT"));
      const onSignal = (signal: NodeJS.Signals): void => stop(signal);
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      httpServer.on("close", () => {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
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
