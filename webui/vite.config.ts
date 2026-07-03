import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { ServerOptions } from "vite-plus";

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
      let shuttingDown = false;

      // Shut down the whole dev session. The daemon polls PNPM_PUB_DEV_SUPERVISOR_PID
      // (this process) and exits on its own when we disappear — so we do NOT
      // signal it here. Signalling the daemon races its own SIGINT handler
      // against its supervisor-watch and can leave it orphaned. Our job is just
      // to stop the Vite server and exit; the daemon's watch cleans it up.
      const shutdown = async (reason: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.error(`[dev] ${reason}; stopping dev session`);
        await server.close().catch(() => {});
        process.exit(0);
      };

      // Best-effort hard kill of the daemon — used ONLY as a synchronous
      // last-resort orphan guard in the exit handler below (where no async
      // work is allowed). The daemon's own supervisor-watch is the primary
      // teardown path.
      const killDaemon = (): void => {
        if (!daemon) return;
        const child = daemon;
        daemon = null;
        if (child.killed) return;
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      };

      const spawnDaemon = (port: number, webuiUrl: string): void => {
        // Spawn node directly with tsx's ESM loader (no `pnpm exec` wrapper
        // chain) so `daemon` holds the real process and its `exit` event fires
        // reliably — a wrapper process can swallow the child's exit.
        const entry = path.resolve(repoRoot(), "src/daemon/dev.ts");
        // Watch BOTH this (vite) process and its outermost surviving ancestor
        // (the `pnpm dev` / `pnpm --dir webui exec` wrapper). On Ctrl-C the
        // outer wrapper often dies before vite does, so watching the ancestor
        // lets the daemon detect teardown even when vite is momentarily orphaned.
        const supervisorPids = [String(outermostAncestorPid()), String(process.pid)]
          .filter((p, i, arr) => arr.indexOf(p) === i)
          .join(",");
        daemon = spawn(process.execPath, ["--import", tsxLoader, entry], {
            stdio: "inherit",
            env: {
              ...process.env,
              PNPM_PUB_DEV_DAEMON_PORT: String(port),
              // webviewUrl carries the token placeholder the daemon substitutes
              // with its real webToken before printing the banner.
              PNPM_PUB_DEV_WEBVIEW_URL: webuiUrl,
              // Comma-separated supervisor PIDs the daemon polls; if ANY dies
              // the daemon tears itself down so it never outlives the dev session.
              PNPM_PUB_DEV_SUPERVISOR_PID: supervisorPids,
            },
          },
        );
        daemon.once("exit", (code, signal) => {
          console.error(
            `[dev] daemon child exit: code=${String(code)} signal=${String(signal)}`,
          );
          shutdown(`daemon exited (code=${String(code)} signal=${String(signal)})`);
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

      // Ctrl-C / SIGTERM on this process → tear the whole session down,
      // waiting for the daemon to exit first so it is never orphaned.
      const onSignal = (signal: NodeJS.Signals): void => {
        void shutdown(`received ${signal}`);
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
      // If Vite closes the HTTP server on its own (e.g. :q in some setups),
      // treat it the same as a signal. `shuttingDown` guards re-entry.
      httpServer.on("close", () => {
        void shutdown("Vite server closed");
      });
      // Last-resort orphan guard: when this process is about to exit for ANY
      // reason (incl. the parent pnpm wrapper dying without forwarding the
      // signal), synchronously SIGKILL the daemon so it can't outlive the dev
      // session. Synchronous-only — no async work allowed in an exit handler.
      // (The daemon's own supervisor-watch is the primary path; this is backup.)
      process.once("exit", killDaemon);
    },
  };
}

function repoRoot(): string {
  // webui/ is one level below the repo root.
  return path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
}

/**
 * Walk the parent-PID chain to its root and return the outermost non-init
 * ancestor. Used as a supervisor PID for the daemon so that Ctrl-C — which
 * often kills an outer `pnpm`/shell wrapper before the vite process — is
 * detected even if vite is momentarily orphaned.
 */
function outermostAncestorPid(): number {
  let pid = process.pid;
  // Stop at PID 1 (init/launchd) — its death is not a meaningful teardown
  // signal and polling it would be noisy.
  while (true) {
    let ppid: number;
    try {
      const parts = readFileSync(`/proc/${pid}/status`, "utf8")
        .split("\n")
        .find((l) => l.startsWith("PPid:"));
      ppid = parts ? Number.parseInt(parts.split(":")[1].trim(), 10) : 0;
    } catch {
      // /proc is Linux-only; on macOS fall back to process.ppid (one level up),
      // which is the immediate pnpm wrapper and dies early enough in practice.
      ppid = process.ppid;
    }
    if (!Number.isSafeInteger(ppid) || ppid <= 1 || ppid === pid) break;
    pid = ppid;
  }
  return pid;
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
    "/__token": { target },
    "/ws": { target, ws: true },
  };
}
