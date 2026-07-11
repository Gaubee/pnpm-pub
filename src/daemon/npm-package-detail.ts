/**
 * Package detail projection (PackageDetail page).
 *
 * npm's registry exposes a full packument via `GET /<pkg>` (readme, versions,
 * time, license, repository, homepage, maintainers). The `safe-npm-sdk` ships
 * no public operation for that read, but its request engine (`client.request`)
 * is public and injects auth headers, retries, and redacted errors for free —
 * so we call it directly with a permissive zod schema. Weekly downloads come
 * from a separate host (`api.npmjs.org/downloads`) with no auth; collaborators
 * (username→access) come from the SDK's `getPackageCollaborators`.
 *
 * Everything is projected into a stable, UI-facing `PackageDetail` shape; raw
 * registry fields never leak across the boundary.
 */
import hostedGitInfo from "hosted-git-info";
import { z } from "zod";
import {
  createClient,
  escapePackageName,
  getPackageCollaborators,
  type NpmClient,
} from "safe-npm-sdk";
import type { PackageCollaborator, PackageDetail } from "../shared/index.js";
import { README_REPOSITORY_PATH_TOKEN } from "../shared/readme.js";

/** Credentials needed to construct a one-shot SDK client (mirrors trusted-publishing-api). */
export interface PackageDetailAuth {
  registry: string;
  token: string;
}

export type PackageDetailResult =
  | { ok: true; detail: PackageDetail }
  | { ok: false; status: number; error: string };

/** npm downloads API host (fixed; not the profile registry). */
const DOWNLOADS_HOST = "https://api.npmjs.org";
const DOWNLOADS_TTL_MS = 5 * 60_000;

// In-flight + short-TTL memo for weekly-download counts (per package name).
// Downloads are anonymous + host-fixed, so they are shared across profiles.
const downloadsCache = new Map<string, { promise: Promise<number>; expiresAt: number }>();

/**
 * Permissive packument schema — the registry returns a large object; we only
 * validate the fields we project, and `.passthrough()` keeps it forward-compat
 * (REST protocol convention, see schemas.ts header).
 */
const PackumentSchema = z
  .object({
    name: z.string(),
    "dist-tags": z.record(z.string(), z.string()).optional(),
    time: z.record(z.string(), z.string()).optional(),
    description: z.string().nullable().optional(),
    readme: z.string().nullable().optional(),
    license: z
      .union([z.string(), z.object({ type: z.string().optional() }).passthrough()])
      .optional(),
    homepage: z.string().nullable().optional(),
    keywords: z.array(z.string()).optional(),
    repository: z
      .union([
        z.string(),
        z.object({ url: z.string().optional(), directory: z.string().optional() }).passthrough(),
      ])
      .nullable()
      .optional(),
    maintainers: z
      .array(z.object({ name: z.string(), email: z.string().nullable().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

function normalizeRegistry(registry: string): string {
  return registry.trim().replace(/\/$/, "") || "https://registry.npmjs.org";
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim().length > 0 ? value.trim() : null;
}

/** Pick a clean displayable URL out of the registry's repository field. */
function repositoryUrl(repo: z.infer<typeof PackumentSchema>["repository"]): string | null {
  if (!repo) return null;
  if (typeof repo === "string") return readString(repo);
  return readString(repo.url);
}

/** Preserve a monorepo package's path relative to its hosted repository root. */
function repositoryDirectory(repo: z.infer<typeof PackumentSchema>["repository"]): string | null {
  if (!repo || typeof repo === "string") return null;
  return readString(repo.directory);
}

type ParsedHostedRepository = NonNullable<ReturnType<typeof hostedGitInfo.fromUrl>>;
type HostedRepository = ParsedHostedRepository & {
  browseFile(path: string): string;
};

function hasBrowseFile(repository: ParsedHostedRepository): repository is HostedRepository {
  return "browseFile" in repository && typeof repository.browseFile === "function";
}

function fallbackRepositoryBrowseUrl(repository: string): string | null {
  const value = repository
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "");
  const scp = /^git@([^:]+):(.+)$/.exec(value);
  const candidate = scp?.[1] && scp[2] ? `https://${scp[1]}/${scp[2]}` : value;
  try {
    const url = new URL(candidate);
    if (url.protocol === "ssh:") url.protocol = "https:";
    url.username = "";
    url.password = "";
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function repositoryLinkProjection(repository: string | null): {
  browseUrl: string | null;
  browseFileTemplate: string | null;
  rawFileTemplate: string | null;
} {
  if (!repository) {
    return { browseUrl: null, browseFileTemplate: null, rawFileTemplate: null };
  }
  const hosted = hostedGitInfo.fromUrl(repository);
  if (!hosted) {
    return {
      browseUrl: fallbackRepositoryBrowseUrl(repository),
      browseFileTemplate: null,
      rawFileTemplate: null,
    };
  }
  return {
    browseUrl: hosted.browse(),
    browseFileTemplate: hasBrowseFile(hosted)
      ? hosted.browseFile(README_REPOSITORY_PATH_TOKEN)
      : null,
    rawFileTemplate: hosted.file(README_REPOSITORY_PATH_TOKEN),
  };
}

/** Best-effort license label (the field is either a string or {type}). */
function licenseLabel(license: z.infer<typeof PackumentSchema>["license"]): string | null {
  if (typeof license === "string") return readString(license);
  if (license && typeof license === "object") return readString(license.type);
  return null;
}

/** ISO-8601 timestamps sort lexically, so `>` is a valid recency compare. */
function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

async function fetchWeeklyDownloads(name: string, signal?: AbortSignal): Promise<number> {
  const cached = downloadsCache.get(name);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    try {
      return await cached.promise;
    } catch {
      // fall through and re-issue
    }
  }
  const url = `${DOWNLOADS_HOST}/downloads/point/last-week/${encodeURIComponent(name)}`;
  const promise = fetch(url, { headers: { accept: "application/json" }, signal })
    .then(async (res) => {
      if (!res.ok) return 0;
      const json = (await res.json()) as { downloads?: unknown };
      return typeof json.downloads === "number" && Number.isFinite(json.downloads)
        ? json.downloads
        : 0;
    })
    .catch(() => 0);
  downloadsCache.set(name, { promise, expiresAt: now + DOWNLOADS_TTL_MS });
  // A failed fetch shouldn't poison the cache; clear it so the next call retries.
  promise.catch(() => {
    if (downloadsCache.get(name)?.promise === promise) downloadsCache.delete(name);
  });
  return promise;
}

/**
 * Fetch the projected detail for a package. Packument 404 → `{ok:false,404}`;
 * a collaborators/downloads failure degrades gracefully (empty / 0) rather than
 * failing the whole response.
 */
export async function fetchPackageDetail(
  name: string,
  auth: PackageDetailAuth,
  signal?: AbortSignal,
): Promise<PackageDetailResult> {
  const cleanName = name.trim();
  if (!cleanName) return { ok: false, status: 400, error: "Invalid package name." };

  const registry = normalizeRegistry(auth.registry);
  const client: NpmClient = createClient({ auth: { token: auth.token }, registry });

  // 1. Packument (the rich metadata + readme).
  const packRes = await client.request({
    method: "GET",
    path: `/${escapePackageName(cleanName)}`,
    schema: PackumentSchema,
  });
  if (!packRes.ok) {
    const status = packRes.error.status || 502;
    return { ok: false, status: status === 404 ? 404 : status, error: packRes.error.message };
  }
  const p = packRes.data;
  const latest = p["dist-tags"]?.latest;
  const time = p.time ?? {};
  const lastPublish = latest ? readString(time[latest]) : null;
  const modified = readString(time.modified) ?? readString(time._nv ?? undefined) ?? lastPublish;

  // 2. Collaborators (username → access level). Degrades to [] on failure.
  let collaborators: PackageCollaborator[] = [];
  const collabRes = await getPackageCollaborators(cleanName, client);
  if (collabRes.ok) {
    collaborators = Object.entries(collabRes.data).map(([username, access]) => ({
      username,
      access: readString(access) ?? undefined,
    }));
  }

  // 3. Weekly downloads (anonymous, separate host). Degrades to 0 on failure.
  const weeklyDownloads = await fetchWeeklyDownloads(cleanName, signal);

  // Maintain a `maintainers` view from the packument when collaborators came
  // back empty (e.g. a registry that doesn't expose the access endpoint).
  const maintainers =
    collaborators.length > 0
      ? collaborators
      : (p.maintainers ?? []).map((m) => ({ username: m.name, email: m.email ?? undefined }));

  const repository = repositoryUrl(p.repository);
  const repositoryLinks = repositoryLinkProjection(repository);

  const detail: PackageDetail = {
    name: p.name ?? cleanName,
    version: latest ?? "0.0.0",
    description: readString(p.description),
    readme: readString(p.readme) ?? "",
    license: licenseLabel(p.license),
    repository,
    repositoryDirectory: repositoryDirectory(p.repository),
    repositoryBrowseUrl: repositoryLinks.browseUrl,
    repositoryBrowseFileTemplate: repositoryLinks.browseFileTemplate,
    repositoryRawFileTemplate: repositoryLinks.rawFileTemplate,
    homepage: readString(p.homepage),
    lastPublish: later(lastPublish, null),
    modified,
    keywords: p.keywords ?? [],
    collaborators: maintainers,
    weeklyDownloads,
  };
  return { ok: true, detail };
}

/** Drop the weekly-download memo for a package (e.g. after unpublish). */
export function invalidatePackageDownloads(name: string): void {
  downloadsCache.delete(name);
}
