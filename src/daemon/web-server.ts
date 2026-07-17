/**
 * WebUI HTTP + WebSocket server (Chapter 3.2.2, 5.2.2, 5.2.3).
 *
 * Serves the SvelteKit SPA from `dist/webui` and upgrades WebSocket connections
 * carrying the daemon's per-process WebToken. WebUI actions are funneled
 * through the shared oRPC contract into the scheduler.
 *
 * Orthogonal intent (2026-07-17, original request): WebUI may complete its
 * exit animation, but it must not report or infer native window visibility.
 */
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { promises as fsp, existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Duplex } from "node:stream";
import { RPCHandler } from "@orpc/server/ws";
import { implement } from "@orpc/server";
import { WebSocketServer } from "ws";
import type { DaemonStore } from "./store.js";
import type { PublishScheduler } from "./scheduler.js";
import type { TrayHost } from "./tray-host.js";
import type { AppUpdateService } from "./app-update.js";
import type {
  BackupBundle,
  PubEvent,
  WsServerMessage,
  TrustedPublisherRegistryConfig,
} from "../shared/index.js";
import { z } from "zod";
import { WsServerMessageSchema } from "../shared/schemas.js";
import {
  findProjectRoot,
  scanWorkspace,
  isPublishableByProfile,
  unpublishableReason,
  isRiskyRoot,
  readWorkspacePackages,
} from "./workspace.js";
import { realFs } from "./real-fs.js";
import { applyToken, verifyCredentials } from "./npm-api.js";
import { getCachedRepoInfo } from "./repo-info.js";
import { listMaintainerPackages, type NpmPackage } from "./npm-packages.js";
import { fetchPackageDetail, type PackageDetailResult } from "./npm-package-detail.js";
import {
  webRpcContract,
  type PackagesListFrame,
  type PackagesQuery,
} from "../shared/orpc-contract.js";
import { readProfileDetail } from "./npm-profile-client.js";
import {
  setToken,
  setTotpSecret,
  deleteToken,
  deleteTotpSecret,
  getProfileSecrets,
  setProfileSecrets,
  type ProfileSecrets,
  activeService,
} from "./keychain.js";
import { generateTotp } from "./totp.js";
import { exportBundle, importBundle } from "./crypto.js";
import { getCachedAvatarPath, lookupNpmProfileIdentity } from "./avatar.js";
import { recordTokenCreatedAt } from "./auto-renew.js";
import { listTrustedPublishers } from "./trusted-publishing-api.js";
import { previewPublishWorkflow, writePublishWorkflow } from "./oidc-workflow.js";
import { kvGet, kvSet } from "./event-db.js";
import { appDir, daemonLogPath, eventsDbPath, profilesPath } from "../shared/paths.js";

export interface WebServerDeps {
  store: DaemonStore;
  scheduler: PublishScheduler;
  webToken: string;
  webuiDir: string;
  appUpdate?: AppUpdateService;
  log?: (message: string) => void;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const PackageSnapshotSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      description: z.string().nullable(),
      repository: z.string().nullable(),
      date: z.string().nullable(),
      scope: z.string().nullable(),
      keywords: z.array(z.string()),
      score: z.number(),
    }),
  ),
  updatedAt: z.number().int().nonnegative(),
});

/**
 * Result of {@link WebServer.resolveTrustAuth}: the active profile's token is
 * either ready to use (`ok`), absent (`missing`), or present but rejected by the
 * registry liveness probe (`expired` — caller should surface a re-auth signal).
 */
type ResolvedAuth =
  | { status: "ok"; token: string; totpSecret: string; registry: string }
  | { status: "missing" }
  | { status: "expired" };

export class WebServer {
  private server?: http.Server;
  private readonly rpcEvents = new EventEmitter();
  private readonly rpcHandler: RPCHandler<Record<never, never>>;
  private readonly rpcWsServer = new WebSocketServer({ noServer: true });

  /**
   * Trusted-publisher lookup cache (Chapter 8.5). npm's `/trust` list is a
   * network call behind 2FA, so we (a) dedup concurrent in-flight checks per
   * package (share one promise) and (b) keep results for 30s before re-querying.
   */
  private trustCache = new Map<
    string,
    { promise: Promise<TrustedPublisherRegistryConfig[]>; expiresAt: number }
  >();
  private static readonly TRUST_CACHE_TTL_MS = 30_000;

  /**
   * Per-profile maintainer package cache (Packages hub). The npm search walk is
   * paginated (250/page), so we cache the full list for ~60s and dedup
   * concurrent in-flight walks for the same profile:registry key.
   */
  private packagesCache = new Map<string, { promise: Promise<NpmPackage[]>; expiresAt: number }>();
  private static readonly PACKAGES_CACHE_TTL_MS = 60_000;
  private static readonly PACKAGES_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Per-package detail projection cache (PackageDetail page). The packument +
   * collaborators + downloads fan-out is several network calls, so we cache the
   * merged projection for ~60s and dedup concurrent in-flight fetches per
   * package:registry. A failure deletes the slot so it isn't poisoned.
   */
  private detailCache = new Map<
    string,
    { promise: Promise<PackageDetailResult>; expiresAt: number }
  >();
  private static readonly DETAIL_CACHE_TTL_MS = 60_000;

  /**
   * Token liveness probe cache. `resolveTrustAuth` verifies the active token
   * against the registry (`listTokens`, a read-only GET) before handing it to a
   * read path, so a stale/expired token flips `authStatus` to `unauthenticated`
   * and surfaces a re-auth signal instead of a confusing 401. The probe is
   * cached per-username for a short window to avoid hammering the registry on
   * every read (profile-detail / packages / trust / unpublish share it).
   * Invalidated whenever credentials change (renew / add / import / re-auth).
   */
  private authProbeCache = new Map<string, { authValid: boolean; expiresAt: number }>();
  private static readonly AUTH_PROBE_TTL_MS = 60_000;

  /**
   * The tray host, attached after construction (it's built later than the
   * WebServer and may stay null in dev/headless). Tray state is exposed as
   * typed WebUI projection frames.
   */
  private trayHost: TrayHost | null = null;

  constructor(private deps: WebServerDeps) {
    this.rpcHandler = new RPCHandler(this.createRpcRouter());
    // Relay store events to every authed WebUI client.
    this.deps.store.on("event", (msg) => this.broadcast(msg));
    this.deps.store.on("group-trust-draft", (msg) => this.broadcast(msg));
    this.deps.store.on("profiles", (msg) => this.broadcast(msg));
    this.deps.store.on("workspaces", (msg) => this.broadcast(msg));
    this.deps.store.on("preferences", (preferences) =>
      this.broadcast({ type: "preferences", preferences }),
    );
    this.deps.store.on("trusted-publishing", (event: { names: string[] }) => {
      for (const name of event.names) this.invalidateTrust(name);
    });
  }

  /** Attach the tray host so WebUI projection frames can include tray state. */
  attachTray(trayHost: TrayHost): void {
    this.trayHost = trayHost;
  }

  async start(port = 0): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
      server.on("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.server = server;
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  // ----- HTTP: SPA + obsolete API tombstone -----

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = (req.url ?? "/").split("?")[0]!;

    // Cached avatar image. Serves the daemon-side PNG cache so the WebUI never
    // hits the npm/gravatar network directly. Authenticated like the rest of
    // the API. If the cache is cold, this awaits (or triggers) the in-flight
    // fetch; on a permanent not-found it 404s (the SPA falls back to initials).
    const avatarMatch = url.match(/^\/api\/avatar\/([^/]+)\.png$/);
    if (avatarMatch) {
      // <img src> can't set Authorization headers, so accept the WebToken as a
      // ?token= query param (same mechanism the WS upgrade uses).
      const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const queryToken = q.get("token") ?? "";
      const headerToken = (req.headers["authorization"] ?? "").startsWith("Bearer ")
        ? (req.headers["authorization"] as string).slice(7)
        : "";
      if (queryToken !== this.deps.webToken && headerToken !== this.deps.webToken) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      const username = decodeURIComponent(avatarMatch[1]!);
      const registry =
        this.deps.store.getProfile(username)?.registry ?? "https://registry.npmjs.org/";
      // Saved profile → pass its token so the resolver takes the reliable
      // authenticated email→Gravatar path (anonymous lookup usually fails).
      const token = await getProfileSecrets(username)
        .then((s) => s?.npm_token)
        .catch(() => undefined);
      const cached = await getCachedAvatarPath(username, registry, { token });
      if (!cached || !existsSync(cached.path)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      try {
        const data = await fsp.readFile(cached.path);
        res.writeHead(200, {
          "content-type": cached.contentType,
          "cache-control": "no-cache",
        });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    if (url.startsWith("/api/")) {
      return json(res, 404, { ok: false, error: "The WebUI API is served over /ws/rpc." });
    }

    // Token delivery endpoint (Chapter 3.2.2 — URL hash injection at opentray
    // load time; this endpoint lets the SPA read its token once at boot).
    if (url === "/__token") {
      const authed = this.checkAuth(req);
      if (!authed) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: this.deps.webToken }));
      return;
    }

    // Static asset serving.
    const dir = this.deps.webuiDir;
    if (!existsSync(dir)) {
      res.writeHead(404);
      res.end("WebUI not built. Run `pnpm build:webui`.");
      return;
    }
    let file = path.join(dir, url === "/" ? "index.html" : url);
    if (!existsSync(file)) {
      // SPA fallback (client-side routing).
      file = path.join(dir, "index.html");
    }
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, { "content-type": contentTypeFor(file) });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    const header = req.headers["authorization"] ?? "";
    if (header.startsWith("Bearer ") && header.slice(7) === this.deps.webToken) return true;
    const url = (req.url ?? "").split("?")[0]!;
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    if (url === "/__token" && q.get("token") === this.deps.webToken) return true;
    return false;
  }

  // ----- WebSocket upgrade -----

  private handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = (req.url ?? "/").split("?")[0]!;
    if (url !== "/ws/rpc") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    // Chapter 3.2.2 "instant interception": the WebToken must be present in
    // the upgrade request. Unauthorized clients never receive a 101 response.
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    const token = q.get("token") ?? "";
    if (token !== this.deps.webToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.rpcWsServer.handleUpgrade(req, socket, head, (ws) => {
      void this.rpcHandler.upgrade(ws, { context: {} }).catch((error: unknown) => {
        this.deps.log?.(`[orpc] websocket upgrade failed: ${errorToMessage(error)}`);
        ws.close();
      });
    });
  }

  private createRpcRouter() {
    const rpc = implement(webRpcContract);
    return rpc.router({
      state: {
        subscribe: rpc.state.subscribe.handler(() => this.subscribeState()),
      },
      profile: {
        select: rpc.profile.select.handler(async ({ input }) => {
          const selected = await this.deps.store.setDefault(input.username);
          if (!selected) return { ok: false, error: `Profile "${input.username}" not found.` };
          this.broadcast({ type: "workspaces", workspaces: this.deps.store.getWorkspaces() });
          return { ok: true };
        }),
        lookupNpm: rpc.profile.lookupNpm.handler(async ({ input }) => {
          try {
            const profile = await lookupNpmProfileIdentity(
              input.username,
              input.registry ?? "https://registry.npmjs.org/",
            );
            return { ok: true, profile };
          } catch (error: unknown) {
            return { ok: false, error: errorToMessage(error) };
          }
        }),
        token: rpc.profile.token.handler(async ({ input }) => {
          let token = this.deps.store.getCredentials(input.username)?.token ?? null;
          if (!token) {
            const secrets = await getProfileSecrets(input.username);
            token = secrets?.npm_token ?? null;
          }
          return token
            ? { ok: true, token }
            : { ok: false, error: "No token stored for this profile." };
        }),
        password: rpc.profile.password.handler(async ({ input }) => {
          let password = this.deps.store.getCredentials(input.username)?.npmPwd ?? null;
          if (!password) {
            const secrets = await getProfileSecrets(input.username);
            password = secrets?.npm_pwd ?? null;
          }
          return password
            ? { ok: true, password }
            : { ok: false, error: "No password stored for this profile." };
        }),
        otp: rpc.profile.otp.handler(async ({ input }) => {
          // Generated daemon-side from the in-memory pool or the merged keychain
          // item (Chapter 3.1: the TOTP secret only lives in daemon memory).
          // Keyed by username — works for any saved profile, not just the
          // active one, mirroring `profile.token` / `profile.password`.
          const username = input.username;
          const creds = this.deps.store.getCredentials(username);
          let totpSecret = creds?.totpSecret ?? null;
          if (!totpSecret) {
            const secrets = await getProfileSecrets(username);
            totpSecret = secrets?.totp_secret ?? null;
            if (secrets && totpSecret) {
              // Warm the pool so subsequent reads don't re-prompt the keychain.
              this.deps.store.setCredentials(username, {
                token: secrets.npm_token,
                totpSecret: secrets.totp_secret,
                npmPwd: secrets.npm_pwd,
              });
            }
          }
          if (!totpSecret) {
            return { ok: false, configured: false, error: "No TOTP secret configured." };
          }
          const now = Date.now();
          const code = generateTotp(totpSecret);
          // RFC 6238 30s step. `30 - k` with k ∈ [0, 29] yields [30, 1], so a
          // fresh window reports the full 30s and the schema's [1, 30] holds.
          const remainingSec = 30 - Math.floor((now / 1000) % 30);
          return { ok: true, code, remainingSec, epochMs: now, configured: true };
        }),
        detail: rpc.profile.detail.handler(async () => {
          const username = this.deps.store.getDefault();
          if (!username) return { ok: false, error: "No active profile.", needsReauth: true };
          const auth = await this.resolveTrustAuth();
          if (!authIsOk(auth)) return authDeniedBody(auth);
          try {
            const detail = await readProfileDetail(auth.token, auth.registry);
            return { ok: true, detail };
          } catch (error: unknown) {
            return { ok: false, error: errorToMessage(error) };
          }
        }),
        add: rpc.profile.add.handler(({ input }) => this.addProfile(input)),
        renew: rpc.profile.renew.handler(({ input }) => this.renewProfile(input)),
        setAutoRenew: rpc.profile.setAutoRenew.handler(async ({ input }) => {
          const existing = this.deps.store.getProfile(input.username);
          if (!existing) return { ok: false, error: "Profile not found." };
          await this.deps.store.upsertProfile({ ...existing, autoRenew: input.autoRenew });
          return { ok: true };
        }),
        delete: rpc.profile.delete.handler(async ({ input }) => {
          const ok = await this.deps.store.removeProfile(input.username);
          return ok ? { ok: true } : { ok: false, error: `Profile ${input.username} not found.` };
        }),
      },
      backup: {
        export: rpc.backup.export.handler(({ input }) => this.exportBundle(input.password)),
        import: rpc.backup.import.handler(({ input }) =>
          this.importBundle(input.bundle, input.password, input.usernames),
        ),
      },
      packages: {
        list: rpc.packages.list.handler(({ input }) => this.listPackagesSWR(input)),
        detail: rpc.packages.detail.handler(async ({ input }) => {
          const result = await this.listPackageDetailCached(input.name);
          return result.ok
            ? { ok: true, detail: result.detail }
            : { ok: false, error: result.error };
        }),
      },
      events: {
        query: rpc.events.query.handler(({ input }) => this.queryEvents(input)),
        queryHistoryGroups: rpc.events.queryHistoryGroups.handler(({ input }) =>
          this.queryHistoryGroups(input),
        ),
        confirm: rpc.events.confirm.handler(async ({ input }) => {
          const ok = await this.deps.scheduler.confirm(input.id);
          return ok ? { ok: true } : { ok: false, error: "No such pending event." };
        }),
        confirmGroup: rpc.events.confirmGroup.handler(async ({ input }) => {
          const result = await this.deps.scheduler.confirmGroup(input.groupId);
          return result.ok ? { ok: true } : { ok: false, error: result.error };
        }),
        reject: rpc.events.reject.handler(({ input }) => {
          const ok = this.deps.scheduler.reject(input.id);
          return ok ? { ok: true } : { ok: false, error: "No such pending event." };
        }),
        update: rpc.events.update.handler(async ({ input }) => {
          const existing = this.deps.store.getEvent(input.id);
          if (
            !existing ||
            existing.status !== "pending" ||
            (existing.payload?.kind !== "publish" &&
              existing.payload?.kind !== "recursive-publish" &&
              existing.payload?.kind !== "create-placeholder")
          ) {
            return { ok: false, error: "Only pending publish-like events can be edited." };
          }
          if (existing.payload.kind !== "create-placeholder") {
            const srcDir =
              existing.payload.data.source.kind === "directory"
                ? existing.payload.data.source.path
                : path.dirname(existing.payload.data.source.path);
            existing.payload.data.branch = await this.detectGitBranch(srcDir);
          }
          const updated = this.deps.store.updateEventArgs(input.id, input.args);
          return updated ? { ok: true } : { ok: false, error: "No such pending event." };
        }),
        updateConfigureTrustDraft: rpc.events.updateConfigureTrustDraft.handler(({ input }) => {
          const updated = this.deps.store.updateConfigureTrustDraft(input.id, input.config);
          return updated ? { ok: true } : { ok: false, error: "No pending configure-trust event." };
        }),
        updateConfigureTrustGroupDraft: rpc.events.updateConfigureTrustGroupDraft.handler(
          ({ input }) => {
            const memberIds = this.deps.store.updateConfigureTrustGroupDraft(
              input.groupId,
              input.config,
            );
            return memberIds.length > 0
              ? { ok: true }
              : { ok: false, error: "No pending configure-trust events in this group." };
          },
        ),
        setMemberInherit: rpc.events.setMemberInherit.handler(({ input }) => {
          const groupId = this.deps.store.setMemberInherit(input.eventId, input.inherit);
          return groupId
            ? { ok: true }
            : { ok: false, error: "No pending configure-trust group member found." };
        }),
        setRemovalDecisions: rpc.events.setRemovalDecisions.handler(({ input }) => {
          const updated = this.deps.store.setRemovalDecisions(input.eventId, input.decisions);
          return updated
            ? { ok: true }
            : { ok: false, error: "No pending trusted-publisher removal found." };
        }),
        create: rpc.events.create.handler(async ({ input }) => ({
          messages: await this.collectMessages((send) =>
            this.createProactiveEvent(input.kind, input.payload, send, input.groupId),
          ),
        })),
      },
      workspace: {
        scan: rpc.workspace.scan.handler(async ({ input }) => ({
          messages: await this.collectMessages((send) => this.scanWorkspace(input.root, send)),
        })),
        pin: rpc.workspace.pin.handler(async ({ input }) => {
          await this.deps.store.pinWorkspace(input.path, input.pinned);
          return { ok: true };
        }),
        remove: rpc.workspace.remove.handler(async ({ input }) => {
          const ok = await this.deps.store.removeWorkspace(input.path);
          return { ok };
        }),
        confirmRisky: rpc.workspace.confirmRisky.handler(async ({ input }) => {
          const ok = await this.deps.store.confirmRiskyWorkspace(input.token);
          return { ok };
        }),
        cancelRisky: rpc.workspace.cancelRisky.handler(({ input }) => {
          this.deps.store.cancelRiskyWorkspace(input.token);
          return { ok: true };
        }),
      },
      repo: {
        info: rpc.repo.info.handler(({ input }) => ({
          ok: true,
          info: getCachedRepoInfo(this.deps.store.getEventDb(), input.repo),
        })),
        openPath: rpc.repo.openPath.handler(({ input }) => this.openExternal(input.path)),
        openUrl: rpc.repo.openUrl.handler(({ input }) => this.openExternal(input.url)),
      },
      trustedPublishing: {
        listTrust: rpc.trustedPublishing.listTrust.handler(async ({ input }) => {
          const result = await this.listTrustCached(input.package);
          return result.ok
            ? { ok: true, configs: result.configs }
            : { ok: false, error: result.error, needsReauth: result.needsReauth };
        }),
      },
      setupOidc: {
        previewWorkflow: rpc.setupOidc.previewWorkflow.handler(async ({ input }) => {
          const result = await previewPublishWorkflow(input.packagePath, input.config);
          return result;
        }),
        writeWorkflow: rpc.setupOidc.writeWorkflow.handler(async ({ input }) => {
          const result = await writePublishWorkflow(
            input.packagePath,
            input.config,
            input.force ?? false,
          );
          return result;
        }),
      },
      tray: {
        completeAutoClose: rpc.tray.completeAutoClose.handler(async () => {
          await this.trayHost?.completeAutoClose();
          return { ok: true };
        }),
        routeChanged: rpc.tray.routeChanged.handler(({ input }) => {
          this.trayHost?.setRoute(input.pathname);
          return { ok: true };
        }),
      },
      preferences: {
        set: rpc.preferences.set.handler(async ({ input }) => {
          // Single write path for all app-wide preferences. The store merge +
          // emit drives the broadcast (every client, including the WebUI's
          // 「偏好」 tab and the titlebar pin) and TrayHost's auto-close
          // re-evaluation via its preferences subscription.
          await this.deps.store.setPreferences(input.patch);
          return { ok: true };
        }),
      },
      appUpdate: {
        check: rpc.appUpdate.check.handler(async () => {
          const service = this.deps.appUpdate;
          if (!service) throw new Error("Application updates are unavailable.");
          return service.check();
        }),
        install: rpc.appUpdate.install.handler(async () => {
          const service = this.deps.appUpdate;
          return service
            ? service.startInstall()
            : { ok: false, error: "Application updates are unavailable." };
        }),
        restart: rpc.appUpdate.restart.handler(async () => {
          const service = this.deps.appUpdate;
          return service
            ? service.restartNow()
            : { ok: false, error: "Application updates are unavailable." };
        }),
        cancelRestart: rpc.appUpdate.cancelRestart.handler(async () => {
          const service = this.deps.appUpdate;
          return service
            ? service.cancelRestart()
            : { ok: false, error: "Application updates are unavailable." };
        }),
      },
    });
  }

  private async *subscribeState(): AsyncGenerator<WsServerMessage, void, void> {
    const queue: WsServerMessage[] = [
      { type: "hello", webTokenRequired: true },
      { type: "events", events: this.deps.store.getEvents() },
      // One group-trust-draft frame per pending group, so a WebUI refresh
      // recovers the group default config + inherit flags (Chapter 6.2.5).
      ...this.deps.store.getAllGroupTrustDrafts().map(
        (d): WsServerMessage => ({
          type: "group-trust-draft",
          groupId: d.groupId,
          defaultConfig: d.defaultConfig,
          inheritMembers: d.inheritMembers,
        }),
      ),
      {
        type: "profiles",
        default: this.deps.store.getDefault(),
        profiles: this.deps.store.getProfiles(),
      },
      { type: "workspaces", workspaces: this.deps.store.getWorkspaces() },
      {
        type: "runtime-info",
        info: {
          pid: process.pid,
          platform: process.platform,
          appDir: appDir(),
          profilesPath: profilesPath(),
          eventsDbPath: eventsDbPath(),
          daemonLogPath: daemonLogPath(),
          credentialService: activeService(),
        },
      },
      // Preferences is the single read source for the keep-open pin and any
      // future preference field; the WebUI derives `pinned` from `keepOnTop`.
      { type: "preferences", preferences: this.deps.store.getPreferences() },
      ...(this.deps.appUpdate
        ? [{ type: "app-update" as const, update: this.deps.appUpdate.getSnapshot() }]
        : []),
    ];
    if (this.trayHost) {
      queue.push({ type: "pin", ...this.trayHost.getPinState() });
    }

    let wake: (() => void) | null = null;
    const onMessage = (msg: WsServerMessage): void => {
      queue.push(msg);
      wake?.();
      wake = null;
    };
    this.rpcEvents.on("message", onMessage);
    try {
      while (true) {
        while (queue.length > 0) {
          const msg = queue.shift();
          if (msg) yield msg;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      this.rpcEvents.off("message", onMessage);
    }
  }

  private async collectMessages(
    action: (send: (data: unknown) => void) => Promise<void> | void,
  ): Promise<WsServerMessage[]> {
    const messages: WsServerMessage[] = [];
    await action((data) => {
      const parsed = WsServerMessageSchema.safeParse(data);
      if (parsed.success) messages.push(parsed.data);
    });
    return messages;
  }

  private async openExternal(target: string): Promise<{ ok: boolean; error?: string }> {
    // Expand a leading `~` to the user home dir. `execFile` does NOT run a
    // shell, so `~` would otherwise be treated as a literal directory name and
    // the open would silently fail (e.g. opening a downloaded file from
    // `~/Downloads`). Also normalize `~user` is intentionally unsupported.
    const resolved = target === "~" ? os.homedir() : target.replace(/^~(?=\/|\\)/, os.homedir());
    const cmd =
      process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["", resolved] : [resolved];
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(cmd, args, { maxBuffer: 1024 });
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, error: errorToMessage(error) };
    }
  }

  /**
   * Detect the current git branch for a directory. Returns '' when the path is
   * not inside a git work tree, or git is unavailable — the caller treats an
   * empty result as "unknown branch". Used only to surface a hint in the UI's
   * publish-branch option; the scheduler's own preflight
   * (`checkPublishGitState`) is the authoritative gate, not this value.
   */
  private async detectGitBranch(dir: string): Promise<string> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync("git", ["-C", dir, "branch", "--show-current"], {
        maxBuffer: 1024,
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private async scanWorkspace(root: string, send: (data: unknown) => void): Promise<void> {
    const { store } = this.deps;
    const found = await findProjectRoot(root, realFs);

    // Chapter 5.3.2 risk-boundary state machine. If no project marker is found,
    // or the resolved root is a broad/system directory, we DO NOT persist it.
    // Instead we stage it and surface a confirmation request; only an explicit
    // `workspace.confirmRisky` RPC call writes it to workspaces.json.
    if (!found.root || isRiskyRoot(found.root, realFs)) {
      const target = found.root ?? root;
      const token = store.stageRiskyWorkspace({ path: target, pinned: false, addedAt: Date.now() });
      send({
        type: "toast",
        level: "warning",
        message:
          "No Git or NPM project markers found. Adding this directory may cause the OS to stall. " +
          "Confirm in the tray to add it anyway (token staged).",
      });
      // Push a packages frame carrying the staged confirmation token so the UI
      // can render an explicit confirm affordance (Chapter 5.3.2).
      send({
        type: "packages",
        root: target,
        packages: [],
        riskyConfirmationToken: token,
      });
      return;
    }

    await store.addWorkspace({ path: found.root, pinned: false, addedAt: Date.now() });
    // Chapter 5.3.4: honor .gitignore so build/coverage outputs etc. are excluded.
    const pkgs = await scanWorkspace(found.root, realFs, {
      root: found.root,
      respectGitignore: true,
    });
    // Detect a pnpm workspace (pnpm-workspace.yaml present) so the UI can offer
    // a "Recursive Publish" action that runs `pnpm publish -r`.
    const workspaceGlobs = await readWorkspacePackages(found.root, realFs);
    const isPnpmWorkspace = workspaceGlobs !== null;
    send({
      type: "packages",
      root: found.root,
      packages: pkgs.map((p) => ({
        name: p.name,
        version: p.version,
        description: p.description,
        path: p.path,
        ...(p.repository ? { repository: p.repository } : {}),
        ...(p.publishConfig ? { publishConfig: p.publishConfig } : {}),
        publishable: isPublishableByProfile(p, store.getDefault()),
        ...(() => {
          const reason = unpublishableReason(p, store.getDefault());
          return reason ? { unpublishableReason: reason } : {};
        })(),
      })),
      ...(isPnpmWorkspace ? { isPnpmWorkspace } : {}),
    });
  }

  private async createProactiveEvent(
    kind: PubEvent["kind"],
    payload: unknown,
    send: (data: unknown) => void,
    groupId?: string,
  ): Promise<void> {
    const profile = this.deps.store.getDefault();
    if (!profile) {
      send({ type: "toast", level: "error", message: "Select a profile first." });
      return;
    }
    const result = await this.deps.scheduler.createProactiveEvent(kind, profile, payload, groupId);
    if (!result.ok) {
      send({ type: "toast", level: "error", message: result.error });
      return;
    }
    // For publish events, fill the current-branch hint from the source path so
    // the EventCard's publish-branch option can show it on first render (before
    // the user edits anything). Re-broadcast via updateEventArgs so the branch
    // is persisted alongside the args.
    if (result.event.payload?.kind === "publish") {
      const src = result.event.payload.data.source;
      const srcDir = src.kind === "directory" ? src.path : path.dirname(src.path);
      result.event.payload.data.branch = await this.detectGitBranch(srcDir);
      this.deps.store.updateEventArgs(result.event.id, result.event.payload.data.args);
    }
    send({ type: "event", event: result.event });
    // No "pending event created" toast — the new pending event surfaces on the
    // Dynamic Island directly via the pending-group reflection in +layout.svelte
    // (a richer live-activity slot: summary, detail, progress, jump-to-card).
    // A redundant toast would just compete for the same single island slot.
  }

  /** Broadcast a typed projection frame to every WebUI oRPC subscriber. */
  broadcast(msg: WsServerMessage): void {
    this.rpcEvents.emit("message", msg);
  }

  /** URL hash the opentray host should load to inject the WebToken (Chapter 3.2.2). */
  webUiUrl(port: number): string {
    return `http://127.0.0.1:${port}/#token=${this.deps.webToken}`;
  }

  /** Log-safe WebUI URL: never serialize the lifecycle WebToken to disk. */
  webUiUrlRedacted(port: number): string {
    return `http://127.0.0.1:${port}/#token=<redacted>`;
  }

  // ----- JSON API handlers (Chapter 8.1 onboarding, 8.2 import/export, 6.2.4 renew) -----

  /** Add-profile / onboarding flow with graceful fallback (Chapter 8.1). */
  private async addProfile(body: {
    username: string;
    password: string;
    totpSecret: string;
    registry?: string;
    manualToken?: string;
  }): Promise<{ ok: boolean; needsManualToken?: boolean; error?: string }> {
    const registry = body.registry ?? "https://registry.npmjs.org/";
    let token = body.manualToken;
    if (!token) {
      const res = await applyToken({
        registry,
        username: body.username,
        password: body.password,
        totpSecret: body.totpSecret,
      });
      if (!res.ok) {
        return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
      }
      token = res.token;
    }
    // Side-effect-free credential check before persisting: confirms the token
    // is valid AND the TOTP secret produces an accepted OTP. A bad token or a
    // wrong totpSecret is caught here rather than surfacing on the first publish.
    const verified = await verifyCredentials({
      registry,
      token: token!,
      totpSecret: body.totpSecret,
    });
    if (!verified.ok || !verified.check?.authValid || verified.check.otpValid === false) {
      const reason = verified.check?.message ?? verified.error ?? "credential verification failed";
      return { ok: false, needsManualToken: verified.check?.authValid === false, error: reason };
    }
    // Chapter 4.1 / 8.1 consistency: persist keychain first, then profiles.json.
    // If the profiles.json write fails, roll back the keychain entries so we
    // never leave an orphaned credential with no profile to manage it.
    try {
      // Merged auth item: ONE keychain write holds token + totp + npm password
      // (password kept so an expired token can be silently re-minted later).
      const secrets: ProfileSecrets = {
        npm_token: token!,
        totp_secret: body.totpSecret,
        npm_pwd: body.password,
      };
      await setProfileSecrets(body.username, secrets);
      const identity = await lookupNpmProfileIdentity(body.username, registry, {
        token,
      });
      await this.deps.store.upsertProfile({
        username: body.username,
        registry,
        avatarUrl: identity.avatarUrl ?? undefined,
        authStatus: "authenticated",
        // New profiles opt into proactive token re-mint by default. NPM session
        // tokens expire within hours; without auto-renew the user would hit an
        // expired-token wall on their next publish. The user can opt out from the
        // profile detail page. (Renew/re-auth preserves the prior value via the
        // `...profile` spread, so this default only applies to brand-new profiles.)
        autoRenew: true,
      });
    } catch (error: unknown) {
      const { deleteProfile } = await import("./keychain.js");
      await deleteProfile(body.username).catch(() => {});
      return { ok: false, error: `Failed to persist profile: ${errorToMessage(error)}` };
    }
    // Populate the in-memory credential pool immediately (incl. password).
    this.deps.store.setCredentials(body.username, {
      token: token!,
      totpSecret: body.totpSecret,
      npmPwd: body.password,
    });
    this.invalidateAuthProbe(body.username);
    return { ok: true };
  }

  /**
   * Renew / silent re-mint. The password is OPTIONAL: when omitted, the stored
   * `npm_pwd` (from the merged keychain item) is reused so a token can be
   * refreshed without re-prompting the user. If the stored password has changed
   * / no longer works (applyToken fails without `needsManualToken`), the profile
   * is marked `authStatus: 'unauthenticated'` so the WebUI forces re-auth.
   */
  private async renewProfile(body: {
    username: string;
    password?: string;
    registry?: string;
    manualToken?: string;
    totpSecret?: string;
  }): Promise<{ ok: boolean; needsManualToken?: boolean; error?: string }> {
    const profile = this.deps.store.getProfile(body.username);
    if (!profile) {
      return { ok: false, error: `Profile ${body.username} not found.` };
    }
    const creds = this.deps.store.getCredentials(body.username);
    const previousToken = creds?.token ?? null;
    // TOTP comes from the pool, else the merged keychain item (one read) —
    // never the legacy split items (would prompt + lack the password).
    const fallbackSecrets = creds?.totpSecret ? null : await getProfileSecrets(body.username);
    const previousTotpSecret = creds?.totpSecret ?? fallbackSecrets?.totp_secret ?? null;
    const incomingTotpSecret = body.totpSecret?.trim() || undefined;
    const totpSecret = previousTotpSecret ?? incomingTotpSecret;
    if (!totpSecret) {
      return { ok: false, error: `No TOTP secret loaded for ${body.username}.` };
    }
    // Resolve the password: explicit body first, then the stored npm_pwd.
    const storedSecrets = creds?.npmPwd ? null : await getProfileSecrets(body.username);
    const password = body.password ?? creds?.npmPwd ?? storedSecrets?.npm_pwd;
    const registry = body.registry ?? profile.registry ?? "https://registry.npmjs.org/";
    let token = body.manualToken;
    if (!token) {
      if (!password) {
        // No password available anywhere → cannot silently re-mint; force re-auth.
        await this.deps.store.upsertProfile({ ...profile, authStatus: "unauthenticated" });
        return { ok: false, error: `No stored password for ${body.username}; re-authenticate.` };
      }
      const res = await applyToken({
        registry,
        username: body.username,
        password,
        totpSecret,
      });
      if (!res.ok) {
        // Password rejected (not a rate-limit manual-token fallback) → it changed;
        // mark unauthenticated so the UI asks for the new password.
        if (!res.needsManualToken) {
          await this.deps.store.upsertProfile({ ...profile, authStatus: "unauthenticated" });
        }
        return { ok: false, needsManualToken: res.needsManualToken, error: res.error };
      }
      token = res.token;
    }
    // Side-effect-free credential check before persisting the new token: this
    // also validates manually-pasted tokens (which are otherwise unchecked until
    // the first publish). Old keychain state is untouched on failure.
    const verified = await verifyCredentials({ registry, token: token!, totpSecret });
    if (!verified.ok || !verified.check?.authValid || verified.check.otpValid === false) {
      const reason = verified.check?.message ?? verified.error ?? "credential verification failed";
      return { ok: false, needsManualToken: verified.check?.authValid === false, error: reason };
    }
    try {
      // Re-write the merged auth item with the new token (keep password/totp).
      const secrets: ProfileSecrets = {
        npm_token: token!,
        totp_secret:
          incomingTotpSecret && incomingTotpSecret !== previousTotpSecret
            ? incomingTotpSecret
            : totpSecret,
        npm_pwd: password!,
      };
      await setProfileSecrets(body.username, secrets);
      const identity = await lookupNpmProfileIdentity(body.username, registry, {
        token,
      });
      await this.deps.store.upsertProfile({
        ...profile,
        registry,
        avatarUrl: identity.avatarUrl ?? profile.avatarUrl,
        authStatus: "authenticated",
      });
    } catch (error: unknown) {
      await this.restoreRenewCredentialState(body.username, previousToken, previousTotpSecret);
      return { ok: false, error: `Failed to renew profile: ${errorToMessage(error)}` };
    }
    this.deps.store.setCredentials(body.username, { token: token!, totpSecret, npmPwd: password });
    this.invalidateAuthProbe(body.username);
    // Record when this fresh token was minted so the AutoRenew scheduler's
    // proactive (time-based) strategy knows when the 2h session window closes.
    recordTokenCreatedAt(this.deps.store, body.username);
    return { ok: true };
  }

  /**
   * Resolve the active profile's token + TOTP secret for an authenticated read
   * (profile-detail / packages / trust / unpublish). Returns a three-state
   * result so callers can distinguish "no credentials at all" from "credentials
   * present but the token is no longer accepted by the registry":
   *
   * - `missing` — no default profile, or no stored token/TOTP at all.
   * - `expired` — a token exists but the liveness probe (`verifyCredentials`,
   *   a read-only `listTokens`) reported `authValid:false`. The profile's
   *   `authStatus` is flipped to `unauthenticated` (and broadcast via the store)
   *   so the WebUI routes the user to re-auth instead of retrying blindly.
   * - `ok` — token + TOTP + registry, ready to use.
   *
   * The liveness probe result is cached per-username for a short window
   * ({@link AUTH_PROBE_TTL_MS}); a transport-level probe failure is treated
   * conservatively as `ok` (don't kill a token on a transient network blip —
   * the real request will surface the genuine error if the token is actually
   * bad). The cache is cleared on any credential change (renew/add/import).
   */
  private async resolveTrustAuth(): Promise<ResolvedAuth> {
    const username = this.deps.store.getDefault();
    if (!username) {
      this.deps.log?.("[auth] resolveTrustAuth: no default profile");
      return { status: "missing" };
    }
    const profile = this.deps.store.getProfile(username);
    const registry = profile?.registry ?? "https://registry.npmjs.org/";
    const creds = this.deps.store.getCredentials(username);
    // Prefer the in-memory pool; otherwise read the MERGED keychain item once
    // (one auth prompt) and warm the pool for subsequent calls.
    let token: string;
    let totpSecret: string;
    if (creds?.token && creds.totpSecret) {
      token = creds.token;
      totpSecret = creds.totpSecret;
    } else {
      const secrets = await getProfileSecrets(username);
      if (!secrets) {
        this.deps.log?.(`[auth] resolveTrustAuth: no merged secrets for ${username}`);
        return { status: "missing" };
      }
      token = secrets.npm_token;
      totpSecret = secrets.totp_secret;
      this.deps.store.setCredentials(username, { token, totpSecret, npmPwd: secrets.npm_pwd });
    }

    // Liveness probe — short-TTL cached so the read paths share one verdict.
    const cached = this.authProbeCache.get(username);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.authValid
        ? { status: "ok", token, totpSecret, registry }
        : { status: "expired" };
    }
    let authValid = true;
    try {
      const verified = await verifyCredentials({ registry, token, totpSecret });
      // The SDK folds 401/403 into `check.authValid === false`; transport errors
      // surface as `!ok` and are treated conservatively as "still valid".
      authValid = verified.ok ? (verified.check?.authValid ?? true) : true;
    } catch (e) {
      this.deps.log?.(
        `[auth] resolveTrustAuth: probe failed for ${username} (${errorToMessage(e)}); treating as valid`,
      );
      authValid = true;
    }
    this.authProbeCache.set(username, {
      authValid,
      expiresAt: Date.now() + WebServer.AUTH_PROBE_TTL_MS,
    });
    if (!authValid) {
      this.deps.log?.(
        `[auth] resolveTrustAuth: token for ${username} is no longer valid; flipping authStatus`,
      );
      // Flip + broadcast so the WebUI offers re-auth. Only persist when the
      // profile actually changed to avoid spurious keychain/profiles writes.
      if (profile && profile.authStatus !== "unauthenticated") {
        await this.deps.store.upsertProfile({ ...profile, authStatus: "unauthenticated" });
      }
      return { status: "expired" };
    }
    return { status: "ok", token, totpSecret, registry };
  }

  /** Clear the liveness-probe cache for a profile (call on credential change). */
  private invalidateAuthProbe(username: string): void {
    this.authProbeCache.delete(username);
  }

  /**
   * List trusted publishers for a package, with 30s caching + in-flight dedup
   * (same package → share one promise). Mutating routes (add/remove) invalidate
   * the cached entry so the next list reflects the change.
   */
  private async listTrustCached(
    name: string,
  ): Promise<
    | { ok: true; configs: TrustedPublisherRegistryConfig[] }
    | { ok: false; status: number; error: string; needsReauth?: boolean }
  > {
    const cached = this.trustCache.get(name);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      const configs = await cached.promise;
      return { ok: true, configs };
    }
    const auth = await this.resolveTrustAuth();
    if (auth.status !== "ok") {
      return auth.status === "expired"
        ? { ok: false, status: 401, error: "Token expired or no longer valid.", needsReauth: true }
        : { ok: false, status: 401, error: "No active profile credentials for this operation." };
    }
    const promise = listTrustedPublishers(auth, name).then((r) =>
      r.ok ? r.configs : Promise.reject(r),
    );
    this.trustCache.set(name, { promise, expiresAt: now + WebServer.TRUST_CACHE_TTL_MS });
    try {
      const configs = await promise;
      return { ok: true, configs };
    } catch (err) {
      // Rejection carries the structured failure object from listTrustedPublishers.
      this.trustCache.delete(name);
      const fail = err as { ok: false; status: number; error: string };
      return { ok: false, status: fail.status, error: fail.error };
    }
  }

  private invalidateTrust(name: string): void {
    this.trustCache.delete(name);
  }

  private queryEvents(input: {
    scope: "pending" | "history";
    name?: string;
    q: string;
    group?: string;
    page: number;
    limit: number;
  }) {
    let name = input.name;
    const keywords: string[] = [];
    for (const tok of input.q.split(/\s+/).filter(Boolean)) {
      const m = tok.match(/^name:(.+)$/i);
      if (m) name = m[1];
      else keywords.push(tok);
    }
    return this.deps.store.queryEvents({
      status: input.scope,
      ...(name ? { name } : {}),
      ...(keywords.length ? { keywords } : {}),
      ...(input.group ? { groupId: input.group } : {}),
      page: input.page,
      limit: input.limit,
    });
  }

  private queryHistoryGroups(input: { name?: string; q: string; page: number; limit: number }) {
    let name = input.name;
    const keywords: string[] = [];
    for (const tok of input.q.split(/\s+/).filter(Boolean)) {
      const m = tok.match(/^name:(.+)$/i);
      if (m) name = m[1];
      else keywords.push(tok);
    }
    return this.deps.store.queryHistoryGroups({
      ...(name ? { name } : {}),
      ...(keywords.length ? { keywords } : {}),
      page: input.page,
      limit: input.limit,
    });
  }

  private packagesSnapshotKey(username: string, registry: string): string {
    return `packages:${username.toLowerCase()}@${registry}`;
  }

  private readPackagesSnapshot(
    key: string,
  ): { items: NpmPackage[]; updatedAt: number } | undefined {
    const db = this.deps.store.getEventDb();
    if (!db) return undefined;
    const parsed = PackageSnapshotSchema.safeParse(kvGet(db, key));
    return parsed.success ? parsed.data : undefined;
  }

  private writePackagesSnapshot(key: string, items: NpmPackage[]): void {
    const db = this.deps.store.getEventDb();
    if (!db) return;
    kvSet(db, key, { items, updatedAt: Date.now() }, WebServer.PACKAGES_SNAPSHOT_TTL_MS);
  }

  private async fetchMaintainerPackagesCached(
    username: string,
    registry: string,
  ): Promise<NpmPackage[]> {
    const cacheKey = this.packagesSnapshotKey(username, registry);
    const now = Date.now();
    let entry = this.packagesCache.get(cacheKey);
    if (!entry || entry.expiresAt <= now) {
      const promise = listMaintainerPackages(username, registry).catch((err: unknown) => {
        this.packagesCache.delete(cacheKey);
        throw err;
      });
      entry = { promise, expiresAt: now + WebServer.PACKAGES_CACHE_TTL_MS };
      this.packagesCache.set(cacheKey, entry);
    }
    return entry.promise;
  }

  private projectPackages(
    all: NpmPackage[],
    input: PackagesQuery,
    source: "local" | "registry",
    updatedAt: number,
  ): Extract<PackagesListFrame, { ok: true }> {
    const q = input.q.trim().toLowerCase();
    const filtered = q
      ? all.filter((p) => {
          if (p.name.toLowerCase().includes(q)) return true;
          if (p.description && p.description.toLowerCase().includes(q)) return true;
          if (p.keywords.some((k) => k.toLowerCase().includes(q))) return true;
          return false;
        })
      : all;

    const sorted =
      input.sort === "name"
        ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
        : [...filtered].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    const safePageSize = Math.max(1, Math.min(input.pageSize, 100));
    const maxPage = Math.max(0, Math.ceil(sorted.length / safePageSize) - 1);
    const safePage = Math.max(0, Math.min(input.page, maxPage));
    const start = safePage * safePageSize;
    const items = sorted.slice(start, start + safePageSize);
    return {
      ok: true,
      source,
      items,
      total: sorted.length,
      page: safePage,
      pageSize: safePageSize,
      updatedAt,
    };
  }

  private async *listPackagesSWR(
    input: PackagesQuery,
  ): AsyncGenerator<PackagesListFrame, void, void> {
    const username = this.deps.store.getDefault();
    if (!username) {
      yield { ok: false, source: "registry", status: 401, error: "No active profile." };
      return;
    }
    const profile = this.deps.store.getProfile(username);
    const registry = profile?.registry ?? "https://registry.npmjs.org/";
    const cacheKey = this.packagesSnapshotKey(username, registry);

    const snapshot = this.readPackagesSnapshot(cacheKey);
    if (snapshot) {
      yield this.projectPackages(snapshot.items, input, "local", snapshot.updatedAt);
    }

    try {
      const all = await this.fetchMaintainerPackagesCached(username, registry);
      this.writePackagesSnapshot(cacheKey, all);
      yield this.projectPackages(all, input, "registry", Date.now());
    } catch (error: unknown) {
      yield { ok: false, source: "registry", status: 502, error: errorToMessage(error) };
    }
  }

  /**
   * Resolve a single package's detail projection (packument + collaborators +
   * downloads), with ~60s caching + in-flight dedup keyed by `name@registry`.
   * Mirrors {@link fetchMaintainerPackagesCached}'s cache discipline: share one promise while
   * fresh, delete the slot on rejection so a transient failure isn't sticky.
   */
  private async listPackageDetailCached(name: string): Promise<PackageDetailResult> {
    const auth = await this.resolveTrustAuth();
    if (!authIsOk(auth)) {
      const denied = authDeniedBody(auth);
      return { ok: false, status: 401, error: denied.error };
    }
    const cacheKey = `${name.toLowerCase()}@${auth.registry}`;
    const now = Date.now();
    let entry = this.detailCache.get(cacheKey);
    if (!entry || entry.expiresAt <= now) {
      const promise = fetchPackageDetail(name, {
        token: auth.token,
        registry: auth.registry,
      }).catch((err: unknown) => {
        this.detailCache.delete(cacheKey);
        throw err;
      });
      entry = { promise, expiresAt: now + WebServer.DETAIL_CACHE_TTL_MS };
      this.detailCache.set(cacheKey, entry);
    }
    try {
      return await entry.promise;
    } catch (err: unknown) {
      return { ok: false, status: 502, error: errorToMessage(err) };
    }
  }

  private async restoreRenewCredentialState(
    username: string,
    token: string | null,
    totpSecret: string | null,
  ): Promise<void> {
    if (token) {
      await Promise.resolve()
        .then(() => setToken(username, token))
        .catch(() => {});
    } else {
      await Promise.resolve()
        .then(() => deleteToken(username))
        .catch(() => {});
    }
    if (totpSecret) {
      await Promise.resolve()
        .then(() => setTotpSecret(username, totpSecret))
        .catch(() => {});
    } else {
      await Promise.resolve()
        .then(() => deleteTotpSecret(username))
        .catch(() => {});
    }
    if (token && totpSecret) {
      this.deps.store.setCredentials(username, { token, totpSecret });
    } else {
      this.deps.store.deleteCredentials(username);
    }
  }

  /** Export all profile secrets to an encrypted bundle (Chapter 8.2). */
  private async exportBundle(
    password: string,
  ): Promise<{ ok: boolean; bundle?: unknown; error?: string; skipped?: string[] }> {
    const secrets: Record<string, { token: string; totp: string }> = {};
    const skipped: string[] = [];
    for (const profile of this.deps.store.getProfiles()) {
      const creds = this.deps.store.getCredentials(profile.username);
      let token = creds?.token;
      let totpSecret = creds?.totpSecret;
      // Fall back to the MERGED keychain item (one read) — not the legacy split
      // items, which would prompt twice and still lack the password.
      if (!token || !totpSecret) {
        const s = await getProfileSecrets(profile.username);
        token = token ?? s?.npm_token;
        totpSecret = totpSecret ?? s?.totp_secret;
      }
      if (token && totpSecret) {
        secrets[profile.username] = { token, totp: totpSecret };
        // Warm the pool so subsequent reads don't hit keychain again.
        if (!creds) {
          this.deps.store.setCredentials(profile.username, { token, totpSecret });
        }
        continue;
      }
      // Chapter 8.2: warn when a configured profile has no complete credential
      // pair in either memory or OS keychain instead of silently omitting it.
      skipped.push(profile.username);
    }
    if (Object.keys(secrets).length === 0) {
      return { ok: false, error: "No credentials loaded to export." };
    }
    const bundle = exportBundle(secrets, password);
    return { ok: true, bundle, skipped: skipped.length ? skipped : undefined };
  }

  /** Import selected profiles from an encrypted bundle (Chapter 8.2). */
  private async importBundle(
    bundle: BackupBundle,
    password: string,
    usernames: string[],
  ): Promise<{ ok: boolean; imported?: string[]; error?: string }> {
    const decoded = importBundle(bundle, password);
    if (!decoded)
      return { ok: false, error: "Decryption failed — wrong password or tampered file." };
    const imported: string[] = [];
    for (const username of usernames) {
      const entry = decoded[username];
      if (!entry) continue;
      try {
        await setToken(username, entry.token);
        await setTotpSecret(username, entry.totp);
        // Imported backups have no npm password → mark unauthenticated so the
        // user re-auths (which then writes the merged item with the password).
        await this.deps.store.upsertProfile({ username, authStatus: "unauthenticated" });
        this.deps.store.setCredentials(username, { token: entry.token, totpSecret: entry.totp });
        imported.push(username);
      } catch (error: unknown) {
        await this.rollbackImportedProfiles([...imported, username]);
        return {
          ok: false,
          error: `Failed to import profile ${username}: ${errorToMessage(error)}`,
        };
      }
    }
    return { ok: true, imported };
  }

  private async rollbackImportedProfiles(usernames: string[]): Promise<void> {
    for (const username of usernames) {
      await Promise.resolve()
        .then(() => deleteToken(username))
        .catch(() => {});
      await Promise.resolve()
        .then(() => deleteTotpSecret(username))
        .catch(() => {});
      this.deps.store.deleteCredentials(username);
    }
  }
}

// ----- module-level HTTP helpers -----

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function contentTypeFor(filePath: string): string {
  return MIME[path.extname(filePath)] ?? "application/octet-stream";
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Type guard: `true` when {@link ResolvedAuth} carries usable credentials. Use
 * after `const auth = await resolveTrustAuth()` so TypeScript narrows `auth` to
 * the `ok` variant for the authenticated call that follows.
 *
 * @example
 * ```
 * const auth = await this.resolveTrustAuth();
 * if (!authIsOk(auth)) return json(res, 401, authDeniedBody(auth));
 * // auth is now { status:'ok', token, totpSecret, registry }
 * ```
 */
function authIsOk(auth: ResolvedAuth): auth is Extract<ResolvedAuth, { status: "ok" }> {
  return auth.status === "ok";
}

/**
 * Build the 401 denial body for a non-`ok` {@link ResolvedAuth}. The `expired`
 * case carries `needsReauth: true` so the WebUI routes the user to re-auth.
 */
function authDeniedBody(auth: ResolvedAuth): { ok: false; error: string; needsReauth?: boolean } {
  if (auth.status === "expired")
    return { ok: false, error: "Token expired or no longer valid.", needsReauth: true };
  return { ok: false, error: "No active profile credentials for this operation." };
}
