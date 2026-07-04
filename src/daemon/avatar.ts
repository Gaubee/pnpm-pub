/**
 * Avatar fetch + cache (Chapter 1.3.2 / 4.3).
 *
 * NPM no longer exposes a reliable anonymous `/-/user/<username>` avatar
 * endpoint, so resolution is delegated to `safe-npm-sdk`'s `lookupAvatar`,
 * which walks a best-effort fallback chain (authenticated profile email →
 * registry user document → maintainer-search email, each verified against a
 * real Gravatar image) and returns the first hit tagged with its source. This
 * module owns the two layers the SDK does not: a 24h negative cache (so a
 * profile with no resolvable avatar doesn't re-probe every boot) and the
 * PNG fetch + signature validation + on-disk cache that backs the tray icon.
 *
 * The tray icon is the NPM logo composited over the active profile's avatar
 * (Chapter 1.3.2). Compositing is done with the canvas-free approach of
 * embedding the avatar as the tray icon base, with the NPM mark overlaid via
 * the tray host's title — since pure-JS image compositing would add a heavy
 * dependency. Where no avatar exists we fall back to a static NPM-mark icon.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, lookupAvatar, type AvatarSource } from "safe-npm-sdk";
import { avatarCacheDir } from "../shared/paths.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Which link of the {@link lookupAvatar} fallback chain produced the avatar. */
export type NpmAvatarSource = AvatarSource;

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

/** Image types we accept for the cache + their file extension + content-type. */
const ACCEPTED_IMAGE_TYPES = {
  png: { ext: ".png", contentType: "image/png" },
  jpeg: { ext: ".jpg", contentType: "image/jpeg" },
  webp: { ext: ".webp", contentType: "image/webp" },
  gif: { ext: ".gif", contentType: "image/gif" },
} as const;
type AcceptedImage = (typeof ACCEPTED_IMAGE_TYPES)[keyof typeof ACCEPTED_IMAGE_TYPES];

/** Sniff the image type from a buffer's magic bytes (no content-type needed). */
function sniffImage(buf: Buffer): AcceptedImage | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return ACCEPTED_IMAGE_TYPES.png;
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return ACCEPTED_IMAGE_TYPES.jpeg;
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return ACCEPTED_IMAGE_TYPES.webp;
  }
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return ACCEPTED_IMAGE_TYPES.gif;
  }
  return null;
}

/** All extensions we might have cached a username's avatar under. */
const CACHE_EXTENSIONS = Object.values(ACCEPTED_IMAGE_TYPES).map((t) => t.ext);

/**
 * Find an existing cached avatar file for a username (any accepted image type).
 * Returns the path + its content-type, or null.
 */
export function findCachedAvatar(username: string): { path: string; contentType: string } | null {
  for (const ext of CACHE_EXTENSIONS) {
    const file = path.join(avatarCacheDir(), `${username}${ext}`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      const matched = Object.values(ACCEPTED_IMAGE_TYPES).find((t) => t.ext === ext);
      if (matched) return { path: file, contentType: matched.contentType };
    }
  }
  return null;
}

/**
 * Resolve the "not found" marker path for a username. A failed avatar lookup
 * (no resolvable avatar, network error, non-image response) writes a small JSON
 * marker here so the next boot does NOT repeat the slow network resolution.
 * Without this, every daemon startup re-runs the multi-second registry/gravatar
 * probe for profiles whose avatar can't be resolved — the cache only ever
 * recorded successes.
 */
function avatarNegativeCachePath(username: string): string {
  return path.join(avatarCacheDir(), `${username}.notfound.json`);
}

/** How long a negative-cache entry suppresses a re-probe (24h). */
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Is a recent "not found" marker present on disk (within TTL)? */
function hasRecentNegativeCache(username: string): boolean {
  const file = avatarNegativeCachePath(username);
  try {
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { at?: number };
    if (typeof parsed.at !== "number") return false;
    return Date.now() - parsed.at < NEGATIVE_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function writeNegativeCache(username: string): void {
  try {
    fs.mkdirSync(avatarCacheDir(), { recursive: true });
    fs.writeFileSync(avatarNegativeCachePath(username), JSON.stringify({ at: Date.now() }), "utf8");
  } catch {
    /* best-effort */
  }
}

/** Is a cached avatar present on disk (any accepted image type)? */
export function hasCachedAvatar(username: string): boolean {
  return findCachedAvatar(username) !== null;
}

/**
 * Resolve the best currently available npm profile avatar projection by
 * delegating to `safe-npm-sdk`'s `lookupAvatar`.
 *
 * The SDK walks: authenticated profile email → registry `/-/user/{name}` →
 * maintainer-search email, each verified against a real Gravatar image, and
 * returns the first hit with an {@link NpmAvatarSource} tag. A total miss
 * returns `{ avatarUrl: null, source: "none" }` rather than throwing.
 *
 * `token` is the profile's npm access token. When provided the SDK takes the
 * authenticated-profile path (the reliable way npm avatars resolve today);
 * without it the resolver falls back to the anonymous registry/maintainer
 * probes, which are slower and often unsuccessful.
 */
export async function lookupNpmProfileIdentity(
  username: string,
  registry = "https://registry.npmjs.org/",
  options: { token?: string } = {},
): Promise<NpmProfileIdentity> {
  const normalizedUsername = username.trim();
  const normalizedRegistry = registry.trim().replace(/\/$/, "") || "https://registry.npmjs.org";
  if (!normalizedUsername) {
    return {
      username: normalizedUsername,
      registry: normalizedRegistry,
      avatarUrl: null,
      source: "none",
    };
  }

  const client = options.token
    ? createClient({ auth: { token: options.token }, registry: normalizedRegistry })
    : createClient({ registry: normalizedRegistry });

  // lookupAvatar is best-effort and never throws on a miss (it returns
  // source:"none"); it only errs when the client can't be resolved, which we
  // treat as a miss too.
  const result = await lookupAvatar(normalizedUsername, client);
  const data = result.ok
    ? result.data
    : {
        username: normalizedUsername,
        registry: normalizedRegistry,
        avatarUrl: null,
        source: "none" as const,
      };
  return {
    username: normalizedUsername,
    registry: data.registry ?? normalizedRegistry,
    avatarUrl: data.avatarUrl,
    source: data.source,
  };
}

/** A cached avatar's on-disk location + the content-type to serve it as. */
export interface CachedAvatar {
  path: string;
  contentType: string;
}

/**
 * Fetch a profile's avatar from NPM and cache it. Returns the local path +
 * content-type on success, or null when the avatar can't be resolved (network
 * failure, missing user, non-image content). Errors are swallowed — avatars are
 * cosmetic.
 *
 * Accepts PNG/JPEG/WebP/GIF (npm/gravatar commonly serve JPEG, not just PNG);
 * the file is stored with the matching extension and the HTTP route serves it
 * with the correct content-type. (The opentray tray icon needs RGBA PNG and
 * only uses PNG cache entries — see trayIconForProfile.)
 *
 * `token` is the profile's npm access token. When provided the resolver takes
 * the authenticated-profile path (email → Gravatar), which is the reliable way
 * npm avatars resolve today — the registry's `/-/user/<name>` endpoint no
 * longer exposes `avatar`. Without a token the resolver falls back to a slow,
 * often-unsuccessful maintainer-search probe, so callers that have a token
 * should always pass it.
 */
export async function fetchAndCacheAvatar(
  username: string,
  registry = "https://registry.npmjs.org/",
  options: { token?: string } = {},
): Promise<CachedAvatar | null> {
  // Fast path: serve an existing cached avatar (any accepted image type).
  const existing = findCachedAvatar(username);
  if (existing) return existing;
  // Fast path: a recent lookup already failed — skip the slow network probe
  // until the negative-cache TTL expires.
  if (hasRecentNegativeCache(username)) return null;

  try {
    const identity = await lookupNpmProfileIdentity(username, registry, options);
    if (!identity.avatarUrl) {
      writeNegativeCache(username);
      return null;
    }

    const imgRes = await fetch(identity.avatarUrl);
    if (!imgRes.ok) {
      writeNegativeCache(username);
      return null;
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const imgType = sniffImage(buf);
    if (!imgType) {
      writeNegativeCache(username);
      return null;
    }
    fs.mkdirSync(avatarCacheDir(), { recursive: true });
    const file = path.join(avatarCacheDir(), `${username}${imgType.ext}`);
    fs.writeFileSync(file, buf);
    return { path: file, contentType: imgType.contentType };
  } catch {
    // Network errors are transient — don't poison the negative cache for them,
    // but they're still swallowed (avatars are cosmetic).
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
  // opentray's native tray icon requires RGBA PNG. Only a PNG-format cached
  // avatar qualifies; JPEG/WebP/GIF avatars fall back to the platform npm mark.
  if (!username) return null;
  const pngPath = avatarCachePath(username);
  return isCachedAvatarPng(pngPath) ? pngPath : null;
}

function isCachedAvatarPng(file: string): boolean {
  try {
    if (!fs.existsSync(file)) return false;
    const fd = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(PNG_SIGNATURE.length);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      if (read === header.length && isPngBuffer(header)) return true;
    } finally {
      fs.closeSync(fd);
    }
    fs.unlinkSync(file);
    return false;
  } catch {
    return false;
  }
}

function isPngBuffer(buf: Buffer): boolean {
  return (
    buf.length >= PNG_SIGNATURE.length &&
    buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  );
}

/**
 * In-flight avatar fetches keyed by username, so concurrent requests for the
 * same avatar (e.g. the HTTP route + the startup pre-fetch) share a single
 * network probe instead of racing. Resolved promises are cleared on settle.
 */
const inflight = new Map<string, Promise<CachedAvatar | null>>();

/**
 * Get the cached avatar for a username, waiting for (or triggering) the fetch
 * if the cache is cold. This is the entry point the WebUI avatar route uses: it
 * never re-probes the network if a fetch is already running, and it returns the
 * local path + content-type once available (or null if the lookup failed and is
 * within the negative-cache TTL).
 *
 * `token` is forwarded to the resolver so saved profiles take the reliable
 * authenticated email→Gravatar path.
 */
export async function getCachedAvatarPath(
  username: string,
  registry = "https://registry.npmjs.org/",
  options: { token?: string } = {},
): Promise<CachedAvatar | null> {
  // Hot cache: an avatar of any accepted type is already on disk.
  const existing = findCachedAvatar(username);
  if (existing) return existing;
  // Negative cache: a recent lookup already failed — don't re-probe.
  if (hasRecentNegativeCache(username)) return null;
  // Coalesce with any in-flight fetch for this username.
  let p = inflight.get(username);
  if (!p) {
    p = fetchAndCacheAvatar(username, registry, options).finally(() => {
      inflight.delete(username);
    });
    inflight.set(username, p);
  }
  return p;
}
