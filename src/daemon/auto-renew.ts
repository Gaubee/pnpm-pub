/**
 * AutoRenew scheduler — proactively keeps NPM tokens fresh so a publish never
 * fails on a stale token.
 *
 * NPM switched to session-based auth on 2025-12-09: a token minted via
 * `npm login` (username + password + OTP) — exactly what `applyToken` does —
 * is now a SESSION token that expires after 2 hours.
 *   https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/
 *
 * Two complementary strategies, both evaluated on a single 30s tick:
 *
 *  A) PROACTIVE (time-based): the token is re-minted at
 *     `tokenCreatedAt + 2h − 30s`, i.e. ~30s before it would expire. This avoids
 *     any failed publish at all. `tokenCreatedAt` is persisted in the event-db
 *     kv store so it survives daemon restarts.
 *
 *  B) REACTIVE (liveness-based): every tick a lightweight `verifyCredentials`
 *     probe checks whether the token is still accepted. If it is already
 *     invalid (e.g. the token was revoked out-of-band, or the proactive window
 *     was missed), the token is re-minted immediately.
 *
 * Only profiles with `autoRenew === true` are considered. Renewal needs a
 * stored password (`npm_pwd` in the keychain) — without it the profile is left
 * for the user to renew manually (authStatus → unauthenticated).
 */
import type { DaemonStore } from './store.js';
import { applyToken, verifyCredentials } from './npm-api.js';
import { getProfileSecrets, setProfileSecrets, type ProfileSecrets } from './keychain.js';
import { lookupNpmProfileIdentity } from './avatar.js';
import { kvGet, kvSet } from './event-db.js';

/** Tick cadence: evaluate every profile every 30s. */
export const TICK_INTERVAL_MS = 30_000;
/** NPM session tokens minted via `npm login` live for 2 hours. */
export const TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;
/** Re-mint this long before the token would expire (proactive margin). */
export const RENEW_LEAD_TIME_MS = 30_000;
/** kv TTL for the persisted createdAt — well past the 2h token life. */
const KV_TTL_MS = 3 * 60 * 60 * 1000;
const KV_PREFIX = 'autorenew:tokenCreatedAt:';

function kvKey(username: string): string {
  return `${KV_PREFIX}${username}`;
}

/**
 * Record the moment a fresh token was minted, so the proactive strategy knows
 * when the 2h window closes. Called by both the manual renew path
 * (WebServer.renewProfile) and this scheduler after a successful re-mint.
 */
export function recordTokenCreatedAt(store: DaemonStore, username: string, createdAt = Date.now()): void {
  const db = store.getEventDb();
  if (!db) return;
  kvSet(db, kvKey(username), { createdAt }, KV_TTL_MS);
}

/** Read the persisted token creation time (epoch ms), or null when absent/expired. */
export function readTokenCreatedAt(store: DaemonStore, username: string): number | null {
  const db = store.getEventDb();
  if (!db) return null;
  const v = kvGet(db, kvKey(username)) as { createdAt?: unknown } | undefined;
  return typeof v?.createdAt === 'number' ? v.createdAt : null;
}

/**
 * Re-mint the token for a profile using the stored password + TOTP secret.
 * Mirrors `WebServer.renewProfile` but is HTTP-free so the scheduler can call
 * it directly. Returns `{ ok: true }` on success and records tokenCreatedAt.
 *
 * On a non-recoverable failure (password rejected) the profile is flipped to
 * `authStatus: 'unauthenticated'` so the UI prompts for re-auth — same as the
 * manual path.
 */
export async function renewTokenForProfile(
  store: DaemonStore,
  username: string,
  log?: (message: string) => void,
): Promise<{ ok: true } | { ok: false; error: string; needsManualToken?: boolean }> {
  const profile = store.getProfile(username);
  if (!profile) return { ok: false, error: `Profile ${username} not found.` };

  const creds = store.getCredentials(username);
  // TOTP + password come from the credential pool, else the merged keychain item.
  const fallbackSecrets = creds?.totpSecret && creds?.npmPwd ? null : await getProfileSecrets(username);
  const totpSecret = creds?.totpSecret ?? fallbackSecrets?.totp_secret;
  const password = creds?.npmPwd ?? fallbackSecrets?.npm_pwd;
  const registry = profile.registry ?? 'https://registry.npmjs.org/';

  if (!totpSecret) return { ok: false, error: `No TOTP secret for ${username}.` };
  if (!password) {
    await store.upsertProfile({ ...profile, authStatus: 'unauthenticated' });
    return { ok: false, error: `No stored password for ${username}; re-authenticate.` };
  }

  const res = await applyToken({ registry, username, password, totpSecret });
  if (!res.ok) {
    if (!res.needsManualToken) {
      await store.upsertProfile({ ...profile, authStatus: 'unauthenticated' });
    }
    return { ok: false, needsManualToken: res.needsManualToken, error: res.error ?? 'Token apply failed.' };
  }
  if (!res.token) {
    return { ok: false, error: 'Token minting returned no token.' };
  }
  const token = res.token;

  // Validate before persisting.
  const verified = await verifyCredentials({ registry, token, totpSecret });
  if (!verified.ok || !verified.check?.authValid || verified.check.otpValid === false) {
    return { ok: false, error: verified.check?.message ?? verified.error ?? 'verification failed' };
  }

  try {
    const secrets: ProfileSecrets = { npm_token: token, totp_secret: totpSecret, npm_pwd: password };
    await setProfileSecrets(username, secrets);
    const identity = await lookupNpmProfileIdentity(username, registry, { token });
    await store.upsertProfile({ ...profile, registry, avatarUrl: identity.avatarUrl ?? profile.avatarUrl, authStatus: 'authenticated' });
  } catch (error: unknown) {
    return { ok: false, error: `Failed to persist renewed token: ${error instanceof Error ? error.message : String(error)}` };
  }

  store.setCredentials(username, { token, totpSecret, npmPwd: password });
  recordTokenCreatedAt(store, username);
  log?.(`[auto-renew] re-minted token for ${username}`);
  return { ok: true };
}

interface AutoRenewDeps {
  store: DaemonStore;
  log?: (message: string) => void;
}

/**
 * Background scheduler. `start()` kicks a 30s interval; `stop()` clears it.
 * Each tick iterates profiles with `autoRenew === true` and applies the two
 * strategies. A per-profile in-flight guard prevents overlapping renewals.
 */
export class AutoRenewScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inflight = new Set<string>();

  constructor(private readonly deps: AutoRenewDeps) {}

  start(): void {
    if (this.timer) return;
    // Run once shortly after start (don't block boot), then on the interval.
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
    // Fire an initial tick after a short delay so a long-stopped daemon catches
    // up immediately rather than waiting up to 30s.
    setTimeout(() => void this.tick(), 5_000).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One evaluation pass. Exported for testing. */
  async tick(): Promise<void> {
    const { store, log } = this.deps;
    const profiles = store.getProfiles().filter((p) => p.autoRenew === true);
    await Promise.all(profiles.map((p) => this.checkProfile(p.username, log)));
  }

  private async checkProfile(username: string, log?: (message: string) => void): Promise<void> {
    if (this.inflight.has(username)) return;
    this.inflight.add(username);
    try {
      await this.evaluate(username, log);
    } finally {
      this.inflight.delete(username);
    }
  }

  private async evaluate(username: string, log?: (message: string) => void): Promise<void> {
    const { store } = this.deps;
    const creds = store.getCredentials(username);
    const profile = store.getProfile(username);
    if (!creds || !profile) return;
    const registry = profile.registry ?? 'https://registry.npmjs.org/';

    // Strategy A (proactive): re-mint ~30s before the 2h window closes.
    const createdAt = readTokenCreatedAt(store, username);
    if (createdAt !== null) {
      const renewAt = createdAt + TOKEN_LIFETIME_MS - RENEW_LEAD_TIME_MS;
      if (Date.now() >= renewAt) {
        const res = await renewTokenForProfile(store, username, log);
        if (!res.ok) log?.(`[auto-renew] proactive renew failed for ${username}: ${res.error}`);
        return;
      }
    }

    // Strategy B (reactive): probe liveness; renew immediately if already invalid.
    try {
      const v = await verifyCredentials({ registry, token: creds.token, totpSecret: creds.totpSecret });
      if (!v.ok || !v.check?.authValid) {
        const res = await renewTokenForProfile(store, username, log);
        if (!res.ok) log?.(`[auto-renew] reactive renew failed for ${username}: ${res.error}`);
      }
    } catch (error: unknown) {
      log?.(`[auto-renew] liveness probe error for ${username}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
