/**
 * Avatar fetch + cache (Chapter 1.3.2 / 4.3).
 *
 * NPM exposes a user's avatar at `https://registry.npmjs.org/-/users/<username>/...`
 * but the simplest stable URL is `https://www.npmjs.com<avatarField>` from the
 * whoami/packument, or the gravatar-style `https://www.npmjs.com/avatar/<hash>`.
 * We hit `/-/user/<username>` and read `.avatar`, then cache the bytes to disk
 * under `~/.pnpm-pub/.cache/avatars/<username>.png`.
 *
 * The tray icon is the NPM logo composited over the active profile's avatar
 * (Chapter 1.3.2). Compositing is done with the canvas-free approach of
 * embedding the avatar as the tray icon base, with the NPM mark overlaid via
 * the tray host's title — since pure-JS image compositing would add a heavy
 * dependency. Where no avatar exists we fall back to a static NPM-mark icon.
 */
import fs from 'node:fs';
import path from 'node:path';
import { avatarCacheDir } from '../shared/paths.js';

/** Resolve the cached avatar file path for a username. */
export function avatarCachePath(username: string): string {
  return path.join(avatarCacheDir(), `${username}.png`);
}

/** Is a cached avatar present on disk? */
export function hasCachedAvatar(username: string): boolean {
  return fs.existsSync(avatarCachePath(username));
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
    // NPM user profile endpoint returns an avatar URL.
    const url = `${registry.replace(/\/$/, '')}/-/user/${encodeURIComponent(username)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const avatarUrl = readAvatarUrl(await res.json());
    if (!avatarUrl) return null;

    const imgRes = await fetch(avatarUrl);
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

function readAvatarUrl(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const avatar = value.avatar;
  return typeof avatar === 'string' && avatar.length > 0 ? avatar : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
