/**
 * Publish scheduler / interception core (Chapter 3.3, 5.4, 8.3, 8.4).
 *
 * A CLI `publish` intent is NEVER executed directly. It is converted into a
 * Pending Event. Only when the WebUI returns a confirmed `taskId` carrying a
 * valid WebToken does the scheduler reach into the credential pool, build the
 * TOTP, and issue the NPM write (Chapter 3.3.4).
 *
 * The scheduler owns the bridge between an IPC client (the CLI) waiting on a
 * Promise and the WebUI's WS confirm/reject messages.
 */
import { Buffer } from 'node:buffer';
import path from 'node:path';
import type { DaemonStore } from './store.js';
import type { IpcPublishRequest, PubEvent } from '../shared/index.js';
import { publishPackage, configureOidc } from './npm-api.js';
import { OIDC_WORKFLOW_PATH, renderPublishWorkflow, canWriteWorkflow } from './oidc-template.js';
import { promises as fsp } from 'node:fs';

/** Handle given to an IPC client so it can be resolved/rejected later. */
export interface PendingClient {
  /** Send a stdout/stderr frame back to the CLI terminal. */
  log(stream: 'stdout' | 'stderr', data: string): void;
  /** Resolve the CLI with an exit code. */
  exit(code: number, message?: string): void;
}

/** Resolved metadata about a publish target (parsed from the CWD's package.json). */
async function readPublishTarget(cwd: string): Promise<{ name: string; version: string; description?: string }> {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const text = await fsp.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(text) as { name?: string; version?: string; description?: string };
    return {
      name: pkg.name ?? '(unknown)',
      version: pkg.version ?? '0.0.0',
      description: pkg.description,
    };
  } catch {
    return { name: '(unknown)', version: '0.0.0' };
  }
}

/** Resolve which profile a request should use, honoring overrides (Chapter 5.4.5). */
function resolveProfile(store: DaemonStore, override: string | undefined): string {
  if (override && store.getProfile(override)) return override;
  const def = store.getDefault();
  if (def) return def;
  const first = store.getProfiles()[0]?.username;
  return first ?? '';
}

export class PublishScheduler {
  /** taskId -> { event, client } */
  private pending = new Map<string, { event: PubEvent; client: PendingClient }>();

  constructor(private store: DaemonStore) {}

  /**
   * Step 1 (Chapter 3.3.1 / 8.3.5): a CLI publish intent arrives. We freeze it
   * as a pending event and register the waiting client. The WebUI is notified
   * via the store's `event` emitter (consumed by the WS bridge).
   */
  async intercept(req: IpcPublishRequest, client: PendingClient): Promise<void> {
    // Chapter 5.4.5: an explicit --profile override MUST be honored strictly.
    // If the named profile does not exist, fail loudly — never silently fall
    // back to the default identity (that would be the "身份割裂" the spec forbids).
    if (req.profileOverride && req.profileOverride.length > 0) {
      if (!this.store.getProfile(req.profileOverride)) {
        const msg = `Profile "${req.profileOverride}" not found. Add it via the tray GUI first.`;
        client.log('stderr', msg + '\n');
        client.exit(1, msg);
        return;
      }
    }
    const profile = resolveProfile(this.store, req.profileOverride);
    if (!profile) {
      client.log('stderr', 'No profile configured. Add a profile via the tray GUI first.\n');
      client.exit(1, 'No profile');
      return;
    }
    const target = await readPublishTarget(req.cwd);
    const event = this.store.createEvent({
      kind: 'publish',
      profile,
      profileOverride: req.profileOverride,
      payload: {
        kind: 'publish',
        data: {
          cwd: req.cwd,
          args: req.args,
          target: { ...target, path: req.cwd },
        },
      },
    });
    this.pending.set(event.id, { event, client });
    // The WS bridge listens on the store and will notify every WebUI client.
  }

  /** Step 2 (Chapter 3.3.3 / 8.3.8): WebUI confirmed. Execute the write. */
  async confirm(taskId: string): Promise<boolean> {
    const entry = this.pending.get(taskId);
    if (!entry) return false;
    const { event, client } = entry;
    const creds = this.store.getCredentials(event.profile);
    if (!creds) {
      this.store.resolveEvent(taskId, 'failed', 'Missing credentials for profile');
      client.log('stderr', `Credentials not loaded for ${event.profile}\n`);
      client.exit(1, 'Missing credentials');
      this.pending.delete(taskId);
      return true;
    }

    const profile = this.store.getProfile(event.profile);
    const registry = profile?.registry ?? 'https://registry.npmjs.org/';

    // Resolve the publish payload.
    if (event.payload?.kind === 'publish') {
      await this.runPublish(event, client, creds.token, creds.totpSecret, registry);
    } else if (event.payload?.kind === 'setup-oidc') {
      await this.runOidc(event, client, creds.token, creds.totpSecret, registry);
    } else if (event.payload?.kind === 'create-placeholder') {
      await this.runPublish(event, client, creds.token, creds.totpSecret, registry);
    } else if (event.payload?.kind === 'refresh-token') {
      this.store.resolveEvent(taskId, 'success', 'Token refresh requested');
      client.log('stdout', 'Token refresh acknowledged.\n');
      client.exit(0);
    }
    this.pending.delete(taskId);
    return true;
  }

  /** Step 2-alt: WebUI rejected. Relay SIGINT-equivalent to the CLI (Chapter 6.2.2). */
  reject(taskId: string): boolean {
    const entry = this.pending.get(taskId);
    if (!entry) return false;
    const { client } = entry;
    this.store.resolveEvent(taskId, 'rejected', 'Publish canceled by user.');
    client.log('stderr', 'Publish canceled by user.\n');
    client.exit(1, 'Publish canceled by user.');
    this.pending.delete(taskId);
    return true;
  }

  private async runPublish(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<void> {
    if (event.payload?.kind !== 'publish' && event.payload?.kind !== 'create-placeholder') return;
    // Both 'publish' and 'create-placeholder' carry a context with target + cwd.
    const ctx = event.payload.data as { name?: string; version?: string; path: string; target?: { name: string; version: string }; cwd?: string };
    const name = ctx.target?.name ?? ctx.name ?? '(unknown)';
    const version = ctx.target?.version ?? ctx.version ?? '0.0.0';
    const cwd = ctx.cwd ?? ctx.path;
    try {
      // Build the real tarball via `pnpm pack` (fallback `npm pack`) from the
      // package directory (Chapter 1.3.1 / 7.1.2). This replaces the previous
      // Buffer.alloc(0) placeholder with the actual publishable artifact.
      client.log('stdout', `packing ${name}...\n`);
      const { packPackage } = await import('./packer.js');
      const packed = await packPackage(cwd);
      client.log('stdout', `packed ${packed.tarball.length} bytes\n`);

      const result = await publishPackage({
        registry,
        token,
        totpSecret,
        name,
        version,
        tarball: packed.tarball,
        metadata: packed.metadata,
      });
      if (result.stdout) client.log('stdout', result.stdout + '\n');
      if (result.stderr) client.log('stderr', result.stderr + '\n');
      if (result.ok) {
        this.store.resolveEvent(event.id, 'success', result.stdout, {
          clockDriftRecovered: result.clockDriftRecovered,
        });
        client.exit(0);
      } else if (result.expired) {
        // Chapter 6.2.4: token expired/revoked → special Expired event so the
        // UI can prompt for renewal instead of showing a generic failure.
        const msg = `Token for ${event.profile} is expired or revoked. Renew it in the tray.`;
        this.store.resolveEvent(event.id, 'expired', msg);
        client.log('stderr', msg + '\n');
        client.exit(1, msg);
      } else {
        this.store.resolveEvent(event.id, 'failed', result.error);
        client.exit(1, result.error);
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.store.resolveEvent(event.id, 'failed', msg);
      client.log('stderr', msg + '\n');
      client.exit(1, msg);
    }
  }

  private async runOidc(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<void> {
    if (event.payload?.kind !== 'setup-oidc') return;
    const ctx = event.payload.data;
    try {
      // Chapter 8.5 step 9: registry-side OIDC prerequisite (2FA-required).
      const result = await configureOidc({ registry, token, totpSecret, name: ctx.name });

      // Chapter 8.5 step 10 / 1.2.3: write the reference workflow INTO THE
      // PACKAGE DIRECTORY (never the daemon's cwd), and never blindly overwrite
      // an existing publish.yml unless --force was set.
      const targetDir = ctx.path && ctx.path.length > 0 ? ctx.path : process.cwd();
      const workflowFile = path.join(targetDir, OIDC_WORKFLOW_PATH);
      const exists = await fsp
        .access(workflowFile)
        .then(() => true)
        .catch(() => false);
      const blockReason = canWriteWorkflow(exists, !!ctx.force);
      if (blockReason) {
        client.log('stderr', `[oidc] ${blockReason}\n`);
        this.store.resolveEvent(event.id, 'failed', blockReason);
        client.exit(1, blockReason);
        return;
      }
      try {
        await fsp.mkdir(path.dirname(workflowFile), { recursive: true });
        await fsp.writeFile(workflowFile, renderPublishWorkflow(ctx), 'utf8');
        client.log('stdout', `[oidc] wrote ${OIDC_WORKFLOW_PATH}\n`);
      } catch (err) {
        client.log('stderr', `[oidc] could not write workflow: ${(err as Error).message}\n`);
      }
      if (result.stdout) client.log('stdout', result.stdout + '\n');
      if (result.stderr) client.log('stderr', result.stderr + '\n');
      if (result.ok) {
        this.store.resolveEvent(event.id, 'success', result.stdout);
        client.exit(0);
      } else {
        this.store.resolveEvent(event.id, 'failed', result.error);
        client.exit(1, result.error);
      }
    } catch (err) {
      const msg = (err as Error).message;
      this.store.resolveEvent(event.id, 'failed', msg);
      client.log('stderr', msg + '\n');
      client.exit(1, msg);
    }
  }

  /** Reject every still-pending event (daemon shutdown). */
  drainAll(): void {
    for (const id of [...this.pending.keys()]) {
      this.reject(id);
    }
  }
}
