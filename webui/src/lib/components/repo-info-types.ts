/**
 * WebUI mirror of the daemon's RepoInfo types (see `src/daemon/repo-info.ts`).
 *
 * Duplicated (rather than imported) so the SvelteKit bundle contains no Node-only
 * code. Keep in sync with the daemon side.
 */
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
