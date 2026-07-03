/**
 * Maintainer package listing (Packages hub — Chapter 6 / new surface).
 *
 * The npm registry exposes a maintainer-scoped search via the public
 * `/-/v1/search?text=maintainer:USERNAME` endpoint (the same one used by
 * `avatar.ts` to resolve a maintainer email). This module walks all result
 * pages and normalizes them into a stable `NpmPackage` shape so the WebUI can
 * render the active profile's published packages with search / sort / paginate.
 *
 * The search endpoint caps at 250 per page and 10,000 total; we stop as soon as
 * a page is short or the running count reaches `total`. Results are filtered
 * client-side to packages whose `maintainers` list actually contains the
 * username (the `maintainer:` query is good but not exact), so stale publisher
 * matches don't leak in.
 */

/** A package published/maintained by a profile (normalized from registry search). */
export interface NpmPackage {
  name: string;
  version: string;
  description: string | null;
  repository: string | null;
  date: string | null;
  scope: string | null;
  keywords: string[];
  /** npm search score (0–1 region). */
  score: number;
}

const PAGE_SIZE = 250;
/** Registry hard cap on offset for the search endpoint. */
const MAX_TOTAL = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value.trim() : null;
}

function normalizeRegistry(registry: string): string {
  return registry.trim().replace(/\/$/, "") || "https://registry.npmjs.org";
}

function registryUrl(registry: string, pathname: string): string {
  return new URL(pathname, `${registry}/`).toString();
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Derive a clean `owner/repo` style repository string from the search links. */
function readRepository(pkg: Record<string, unknown>): string | null {
  const links = isRecord(pkg.links) ? pkg.links : null;
  const repoUrl = readString(links?.repository) ?? readString(links?.homepage);
  if (!repoUrl) return null;
  // git+https://github.com/owner/repo.git  →  owner/repo
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/i);
  if (match) return `${match[1]}/${match[2]}`;
  return repoUrl;
}

function readScope(name: string): string | null {
  const m = name.match(/^@([^/]+)\//);
  return m ? m[1]! : null;
}

/**
 * Fetch every package the npm registry associates with `username` (as a
 * maintainer). Resilient — a malformed page just short-circuits the walk.
 * Pass an AbortSignal so the WebServer can cancel stale in-flight walks.
 */
export async function listMaintainerPackages(
  username: string,
  registry = "https://registry.npmjs.org/",
  signal?: AbortSignal,
): Promise<NpmPackage[]> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) return [];
  const base = normalizeRegistry(registry);
  const lowerUsername = normalizedUsername.toLowerCase();

  const out: NpmPackage[] = [];
  let from = 0;
  let total = MAX_TOTAL;
  while (from < total) {
    const url = registryUrl(
      base,
      `/-/v1/search?text=${encodeURIComponent(`maintainer:${normalizedUsername}`)}&size=${PAGE_SIZE}&from=${from}`,
    );
    const data = await fetchJson(url, signal);
    if (!isRecord(data) || !Array.isArray(data.objects)) break;
    if (typeof data.total === "number" && Number.isFinite(data.total)) {
      total = Math.min(Math.trunc(data.total), MAX_TOTAL);
    }
    let addedThisPage = 0;
    for (const entry of data.objects) {
      if (!isRecord(entry) || !isRecord(entry.package)) continue;
      const pkg = entry.package as Record<string, unknown>;
      // Defend against the search query returning publisher-only matches:
      // only keep packages whose current maintainers include the username.
      const maintainers = pkg.maintainers;
      const isMaintainer =
        Array.isArray(maintainers) &&
        maintainers.some((m) => {
          if (!isRecord(m)) return false;
          return readString(m.username)?.toLowerCase() === lowerUsername;
        });
      if (!isMaintainer) continue;
      const name = readString(pkg.name);
      if (!name) continue;
      const scoreSrc = isRecord(entry.score) ? entry.score : {};
      const final = scoreSrc.final;
      out.push({
        name,
        version: readString(pkg.version) ?? "0.0.0",
        description: readString(pkg.description),
        repository: readRepository(pkg),
        date: readString(pkg.date) ?? readString(entry.updated),
        scope: readScope(name),
        keywords: Array.isArray(pkg.keywords)
          ? pkg.keywords.map((k) => readString(k)).filter((k): k is string => !!k)
          : [],
        score: typeof final === "number" && Number.isFinite(final) ? final : 0,
      });
      addedThisPage++;
    }
    from += PAGE_SIZE;
    // A short page (or no new maintainers found) means we've exhausted results.
    if (data.objects.length < PAGE_SIZE) break;
    if (addedThisPage === 0 && out.length > 0) break;
  }
  return out;
}
