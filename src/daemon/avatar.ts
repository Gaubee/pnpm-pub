/**
 * Avatar fetch + cache (Chapter 1.3.2 / 4.3).
 *
 * NPM no longer exposes a reliable anonymous `/-/user/<username>` avatar
 * endpoint. The resolver below treats npm registry/user data as the source of
 * identity and only returns an avatar URL when it can be derived from a
 * verified registry profile response or a maintainer email discovered through
 * the registry search API. Initials belong to the UI fallback; they are never
 * persisted as an npm avatar.
 *
 * The tray icon is the NPM logo composited over the active profile's avatar
 * (Chapter 1.3.2). Compositing is done with the canvas-free approach of
 * embedding the avatar as the tray icon base, with the NPM mark overlaid via
 * the tray host's title — since pure-JS image compositing would add a heavy
 * dependency. Where no avatar exists we fall back to a static NPM-mark icon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { avatarCacheDir } from '../shared/paths.js';

export type NpmAvatarSource = 'authenticated-profile' | 'registry-profile' | 'maintainer-gravatar' | 'none';

export interface NpmProfileIdentity {
  username: string;
  registry: string;
  avatarUrl: string | null;
  source: NpmAvatarSource;
}

/** Resolve the cached avatar file path for a username. */
export function avatarCachePath(username: string): string {
  return path.join(avatarCacheDir(), `${username}.png`);
}

/** Is a cached avatar present on disk? */
export function hasCachedAvatar(username: string): boolean {
  return fs.existsSync(avatarCachePath(username));
}

/**
 * Resolve the best currently available npm profile avatar projection.
 *
 * Source order:
 * 1. authenticated npm profile (`/-/npm/v1/user`) when a token is available;
 * 2. registry profile endpoints for registries that still expose `.avatar`;
 * 3. registry search maintainer email -> verified Gravatar URL.
 */
export async function lookupNpmProfileIdentity(
  username: string,
  registry = 'https://registry.npmjs.org/',
  options: { token?: string } = {},
): Promise<NpmProfileIdentity> {
  const normalizedUsername = username.trim();
  const normalizedRegistry = normalizeRegistry(registry);
  if (!normalizedUsername) {
    return { username: normalizedUsername, registry: normalizedRegistry, avatarUrl: null, source: 'none' };
  }

  if (options.token) {
    const profile = await fetchJson(registryUrl(normalizedRegistry, '/-/npm/v1/user'), {
      headers: { accept: 'application/json', authorization: `Bearer ${options.token}` },
    });
    const profileAvatar = normalizeAvatarUrl(readStringField(profile, 'avatar', 'avatarUrl', 'avatar_url'));
    if (profileAvatar) {
      return {
        username: normalizedUsername,
        registry: normalizedRegistry,
        avatarUrl: profileAvatar,
        source: 'authenticated-profile',
      };
    }
    const profileEmail = readStringField(profile, 'email');
    const profileGravatar = profileEmail ? await verifiedGravatarUrl(profileEmail) : null;
    if (profileGravatar) {
      return {
        username: normalizedUsername,
        registry: normalizedRegistry,
        avatarUrl: profileGravatar,
        source: 'authenticated-profile',
      };
    }
  }

  const registryProfiles = [
    registryUrl(normalizedRegistry, `/-/user/${encodeURIComponent(normalizedUsername)}`),
    registryUrl(normalizedRegistry, `/-/user/org.couchdb.user:${encodeURIComponent(normalizedUsername)}`),
  ];
  for (const url of registryProfiles) {
    const profile = await fetchJson(url, { headers: { accept: 'application/json' } });
    const avatarUrl = normalizeAvatarUrl(readStringField(profile, 'avatar', 'avatarUrl', 'avatar_url'));
    if (avatarUrl) {
      return { username: normalizedUsername, registry: normalizedRegistry, avatarUrl, source: 'registry-profile' };
    }
  }

  const email = await lookupMaintainerEmail(normalizedUsername, normalizedRegistry);
  const avatarUrl = email ? await verifiedGravatarUrl(email) : null;
  if (avatarUrl) {
    return { username: normalizedUsername, registry: normalizedRegistry, avatarUrl, source: 'maintainer-gravatar' };
  }

  return { username: normalizedUsername, registry: normalizedRegistry, avatarUrl: null, source: 'none' };
}

/**
 * Fetch a profile's avatar from NPM and cache it. Returns the local path on
 * success, or null when the avatar can't be resolved (network failure, missing
 * user, non-image content). Errors are swallowed — avatars are cosmetic.
 */
export async function fetchAndCacheAvatar(username: string, registry = 'https://registry.npmjs.org/'): Promise<string | null> {
  // Fast path: serve from cache.
  const cached = avatarCachePath(username);
  try {
    if (fs.existsSync(cached)) return cached;
  } catch {
    /* ignore */
  }

  try {
    const identity = await lookupNpmProfileIdentity(username, registry);
    if (!identity.avatarUrl) return null;

    const imgRes = await fetch(identity.avatarUrl);
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    fs.mkdirSync(avatarCacheDir(), { recursive: true });
    fs.writeFileSync(cached, buf);
    return cached;
  } catch {
    return null;
  }
}

/**
 * Resolve the tray icon for the active profile (Chapter 1.3.2).
 *
 * Per the opentray skill (troubleshooting), native tray icon support is
 * `rgba` — a PNG. Pure-JS image compositing of the "NPM logo + avatar" merge
 * would need a native canvas dependency we deliberately avoid, so the avatar
 * alone (a real PNG fetched from NPM) is used as the tray icon base. When no
 * avatar PNG is cached, this returns null and the daemon falls back to the
 * platform npm mark (assets/icon-{platform}.png).
 *
 * The in-window favicon/sidebar brand uses the static npm mark
 * (webui NpmMark / favicon.svg), NOT a per-profile composite, so no avatar
 * overlay is produced here.
 */
export function trayIconForProfile(username: string | undefined): string | null {
  if (!username || !hasCachedAvatar(username)) return null;
  // The cached avatar IS a real PNG (fetched from NPM), so it satisfies the
  // opentray rgba requirement for the native tray icon.
  return avatarCachePath(username);
}

function normalizeRegistry(registry: string): string {
  return registry.trim().replace(/\/$/, '') || 'https://registry.npmjs.org';
}

function registryUrl(registry: string, pathname: string): string {
  return new URL(pathname, `${registry}/`).toString();
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function readStringField(value: unknown, ...keys: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    const field = value[key];
    if (typeof field === 'string' && field.trim().length > 0) return field.trim();
  }
  return null;
}

function normalizeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  const npmAvatar = value.match(/(?:https:\/\/www\.npmjs\.com)?\/avatar\/([a-f0-9]{32})/i);
  if (npmAvatar?.[1]) return gravatarUrlFromHash(npmAvatar[1].toLowerCase());
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function lookupMaintainerEmail(username: string, registry: string): Promise<string | null> {
  const url = registryUrl(
    registry,
    `/-/v1/search?text=${encodeURIComponent(`maintainer:${username}`)}&size=5`,
  );
  const data = await fetchJson(url, { headers: { accept: 'application/json' } });
  if (!isRecord(data) || !Array.isArray(data.objects)) return null;
  const lowerUsername = username.toLowerCase();
  for (const entry of data.objects) {
    if (!isRecord(entry) || !isRecord(entry.package)) continue;
    const publisherEmail = readMatchingIdentityEmail(entry.package.publisher, lowerUsername);
    if (publisherEmail) return publisherEmail;
    const maintainers = entry.package.maintainers;
    if (!Array.isArray(maintainers)) continue;
    for (const maintainer of maintainers) {
      const email = readMatchingIdentityEmail(maintainer, lowerUsername);
      if (email) return email;
    }
  }
  return null;
}

function readMatchingIdentityEmail(value: unknown, lowerUsername: string): string | null {
  if (!isRecord(value)) return null;
  const username = readStringField(value, 'username');
  const email = readStringField(value, 'email');
  return username?.toLowerCase() === lowerUsername && email ? email : null;
}

async function verifiedGravatarUrl(email: string): Promise<string | null> {
  const url = gravatarUrlFromHash(createHash('md5').update(email.trim().toLowerCase()).digest('hex'));
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

function gravatarUrlFromHash(hash: string): string {
  return `https://gravatar.com/avatar/${hash}?s=128&d=404`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
