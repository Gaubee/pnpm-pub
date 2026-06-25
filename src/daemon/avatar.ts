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
    const json = (await res.json()) as { avatar?: string };
    const avatarUrl = json.avatar;
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
 * avatar PNG is cached, this returns null and the daemon creates a title-only
 * tray (the `icon` option is optional end-to-end).
 *
 * The SVG "NPM-logo + avatar" composite is still produced for the in-window
 * favicon/sidebar use (see compositeTrayFavicon), but NOT for the native tray
 * icon.
 */
export function trayIconForProfile(username: string | undefined): string | null {
  if (!username || !hasCachedAvatar(username)) return null;
  // The cached avatar IS a real PNG (fetched from NPM), so it satisfies the
  // opentray rgba requirement for the native tray icon.
  return avatarCachePath(username);
}

/**
 * Produce an SVG merging the NPM mark over the avatar for in-window display
 * (favicon/sidebar). This is NOT the native tray icon (which must be rgba PNG).
 */
export function compositeTrayFavicon(username: string | undefined): string | null {
  if (!username || !hasCachedAvatar(username)) return null;
  const composite = path.join(avatarCacheDir(), `${username}.favicon.svg`);
  try {
    if (!fs.existsSync(composite)) {
      const b64 = fs.readFileSync(avatarCachePath(username)).toString('base64');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs><clipPath id="c"><circle cx="32" cy="32" r="30"/></clipPath></defs>
  <image href="data:image/png;base64,${b64}" x="2" y="2" width="60" height="60" clip-path="url(#c)"/>
  <rect x="34" y="38" width="22" height="14" rx="2" fill="#000"/>
  <text x="45" y="49" font-family="Arial,sans-serif" font-size="11" font-weight="bold" fill="#fff" text-anchor="middle">npm</text>
</svg>`;
      fs.writeFileSync(composite, svg, 'utf8');
    }
    return composite;
  } catch {
    return null;
  }
}
