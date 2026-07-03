/**
 * Repository URL resolver + cached info provider.
 *
 * A package's `repository` field arrives in one of several shapes:
 *  - a bare `owner/repo` slug (host already stripped by `normalizeRepository`
 *    for github/gitlab scans — host unknown, assume github.com),
 *  - a full URL like `git+https://github.com/owner/repo` (registry-sourced),
 *  - an arbitrary host (gitee/bitbucket/codeberg/gitcode/private forge).
 *
 * `resolveRepoInfo` normalizes any of these into a display-ready descriptor:
 * `{ host, shortName, browseUrl, faviconUrl, brand }`. Known forges have a
 * `brand` (inline SVG, no network) and a canonical browse URL; unknown hosts
 * fall back to a third-party favicon service for the icon.
 *
 * Results are cached in the event DB's `key_value` table (7-day TTL) keyed by
 * the raw repository string, so repeated renders of the same package never
 * re-parse.
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { kvGet, kvSet } from "./event-db.js";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_PREFIX = "repo-info:";

export type RepoBrand = "github" | "gitlab" | "gitee" | "bitbucket" | "codeberg" | "gitcode";

export interface RepoInfo {
  /** Lowercased host without scheme (e.g. `github.com`). Empty for bare slugs. */
  host: string;
  /** Repo segment after the last `/` (e.g. `repo` from `owner/repo`). */
  shortName: string;
  /** Full owner/repo slug (e.g. `owner/repo`); falls back to shortName. */
  slug: string;
  /** Full URL to open in a browser. */
  browseUrl: string;
  /** Favicon URL for unknown hosts (third-party service); empty for brands. */
  faviconUrl: string;
  /** Brand key when the host is a known forge (inline SVG icon); else null. */
  brand: RepoBrand | null;
}

/** Known forge host → brand mapping. Substring match on the host. */
const BRAND_HOSTS: { match: string; brand: RepoBrand; url: string }[] = [
  { match: "github.com", brand: "github", url: "https://github.com" },
  { match: "gitlab.com", brand: "gitlab", url: "https://gitlab.com" },
  { match: "gitee.com", brand: "gitee", url: "https://gitee.com" },
  { match: "bitbucket.org", brand: "bitbucket", url: "https://bitbucket.org" },
  { match: "codeberg.org", brand: "codeberg", url: "https://codeberg.org" },
  { match: "gitcode.com", brand: "gitcode", url: "https://gitcode.com" },
];

function matchBrandHost(host: string): { brand: RepoBrand; url: string } | null {
  const entry = BRAND_HOSTS.find((b) => host === b.match || host.endsWith(`.${b.match}`));
  return entry ? { brand: entry.brand, url: entry.url } : null;
}

/**
 * Parse a repository string into a RepoInfo descriptor. Pure (no I/O, no DB) —
 * caching is layered on top by {@link getCachedRepoInfo}.
 */
export function parseRepoInfo(raw: string): RepoInfo | null {
  const input = raw.trim();
  if (!input) return null;

  // Strip a leading `git+` (package.json convention) and trailing `.git`.
  const cleaned = input.replace(/^git\+/, "").replace(/\.git$/i, "");

  // Try to interpret as a URL. `URL` needs a scheme; accept scheme-less by
  // testing for `://` first, otherwise treat as a bare slug.
  let parsedUrl: URL | null = null;
  if (/^[a-z]+:\/\//i.test(cleaned) || cleaned.startsWith("git@")) {
    try {
      // Normalise scp-style `git@host:owner/repo` → ssh URL for URL parsing.
      const sshForm = cleaned.startsWith("git@") ? `ssh://${cleaned.replace(":", "/")}` : cleaned;
      parsedUrl = new URL(sshForm);
    } catch {
      parsedUrl = null;
    }
  }

  // Case A: full URL with a host.
  if (parsedUrl && parsedUrl.host) {
    const host = parsedUrl.host.toLowerCase();
    // Path → `owner/repo` slug (drop leading `/`, strip trailing slash).
    const slug = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, "").replace(/\/+$/, "");
    const shortName = (slug.split("/").pop() ?? slug) || host;
    const brand = matchBrandHost(host);
    if (brand) {
      return {
        host,
        shortName,
        slug: slug || shortName,
        browseUrl: slug ? `${brand.url}/${slug}` : brand.url,
        faviconUrl: "",
        brand: brand.brand,
      };
    }
    // Unknown forge: rebuild a canonical https URL and use a favicon service.
    const browseUrl = `https://${host}${parsedUrl.pathname}`;
    return {
      host,
      shortName,
      slug: slug || shortName,
      browseUrl,
      faviconUrl: `https://icons.duckduckgo.com/ip3/${host}.ico`,
      brand: null,
    };
  }

  // Case B: bare `owner/repo` slug (host stripped at scan time). Assume the
  // canonical forge — GitHub — since that's what `normalizeRepository` bases its
  // slug extraction on, and a plain slug carries no host signal.
  if (/^[\w.@-]+\/[\w.@-]+/.test(cleaned)) {
    const slug = cleaned.replace(/^\/+/, "").replace(/\/+$/, "");
    const shortName = slug.split("/").pop() ?? slug;
    return {
      host: "github.com",
      shortName,
      slug,
      browseUrl: `https://github.com/${slug}`,
      faviconUrl: "",
      brand: "github",
    };
  }

  // Case C: unrecognised — give up gracefully.
  return null;
}

/**
 * Resolve repo info, backed by the event DB's TTL cache. On a miss, parses and
 * caches the result (including nulls, so a bad repo string isn't re-parsed
 * every render). Pass `db = null` to bypass persistence (parse-only).
 */
export function getCachedRepoInfo(db: DatabaseType | null, raw: string): RepoInfo | null {
  const key = CACHE_PREFIX + raw;
  if (db) {
    const cached = kvGet(db, key);
    if (cached !== undefined) return (cached as { v: RepoInfo | null }).v ?? null;
  }
  const info = parseRepoInfo(raw);
  if (db) {
    kvSet(db, key, { v: info }, CACHE_TTL_MS);
  }
  return info;
}
