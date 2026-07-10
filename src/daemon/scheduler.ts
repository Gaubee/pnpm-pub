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
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import type { DaemonStore } from "./store.js";
import type {
  CreatePlaceholderContext,
  EventKind,
  EventPayload,
  IpcOidcRequest,
  IpcPublishRequest,
  ConfigureTrustContext,
  PublishConfig,
  PublishContext,
  PublishSource,
  PublishTarget,
  PubEvent,
  RecursivePublishContext,
  RemovalDecisions,
  RefreshTokenContext,
  TrustedPublisherConfig,
  TrustedPublisherCreateConfig,
  TrustedPublisherPermission,
  TrustedPublisherRegistryConfig,
  TrustedPublishingTarget,
  UnpublishContext,
} from "../shared/index.js";
import {
  TrustedPublisherConfigSchema,
  TrustedPublisherCreateConfigSchema,
} from "../shared/index.js";
import {
  packPackage,
  previewPackageFiles,
  readPackageTarball,
  summarizePackageTarball,
  type PackageTarballFile,
  type PackageTarballSummary,
} from "./packer.js";
import { publishPackage, unpublishVersion } from "./npm-api.js";
import {
  publishPackageViaCli,
  publishRecursiveViaCli,
  listRecursivePackages,
  hasPnpm,
  PnpmNotOnPathError,
} from "./publisher.js";
import { promises as fsp } from "node:fs";
import { realFs } from "./real-fs.js";
import {
  findProjectRoot,
  isRiskyRoot,
  scanWorkspace,
  parseRepository,
  readGitRemoteUrl,
} from "./workspace.js";
import { parsePackagePublishConfig } from "./package-publish-config.js";
import { checkPublishGitState } from "./publish-git-checks.js";
import {
  addTrustedPublisher,
  listTrustedPublishers,
  removeTrustedPublisher,
} from "./trusted-publishing-api.js";

const execFileAsync = promisify(execFile);

/**
 * Daemon-side trusted-publisher config equality (mirror of the webui helper).
 * Used by the configure-trust pre-flight to decide skip vs conflict. Ignores
 * the registry-assigned `id` and normalizes CircleCI context-ids. Permissions
 * default to both-true when absent.
 */
function trustedPublisherConfigsEqual(
  desired: TrustedPublisherCreateConfig,
  existing: TrustedPublisherConfig,
): boolean {
  if (desired.type !== existing.type) return false;
  const norm = (perms: string[] | undefined) => ({
    allowPublish: (perms ?? ["createPackage", "createStagedPackage"]).includes("createPackage"),
    allowStagePublish: (perms ?? ["createPackage", "createStagedPackage"]).includes(
      "createStagedPackage",
    ),
  });
  const dp = norm(desired.permissions);
  const ep = norm(existing.permissions);
  if (dp.allowPublish !== ep.allowPublish || dp.allowStagePublish !== ep.allowStagePublish) {
    return false;
  }
  const dv = extractTrustedPublishingFieldValues(desired);
  const ev = extractTrustedPublishingFieldValues(existing);
  for (const key of Object.keys(dv)) {
    if ((dv[key] ?? "").trim() !== (ev[key] ?? "").trim()) return false;
  }
  return true;
}

/** Flatten a trusted-publisher config's claims into a comparable value map
 *  (daemon-side mirror of the webui helper). `id` is dropped. */
function extractTrustedPublishingFieldValues(
  config: TrustedPublisherCreateConfig | TrustedPublisherConfig,
): Record<string, string> {
  const v: Record<string, string> = {
    repoOwner: "",
    repoName: "",
    workflowFile: "",
    ciFilePath: "",
    environment: "",
    orgId: "",
    circleProjectId: "",
    pipelineDefinitionId: "",
    contextIds: "",
    vcsOrigin: "",
  };
  if (config.type === "github") {
    const [owner, ...rest] = config.claims.repository.split("/");
    v.repoOwner = owner ?? "";
    v.repoName = rest.join("/");
    v.workflowFile = config.claims.workflow_ref.file;
    v.environment = config.claims.environment ?? "";
  } else if (config.type === "gitlab") {
    const [owner, ...rest] = config.claims.project_path.split("/");
    v.repoOwner = owner ?? "";
    v.repoName = rest.join("/");
    v.ciFilePath = config.claims.ci_config_ref_uri ?? "";
    v.environment = config.claims.environment ?? "";
  } else {
    v.orgId = config.claims["oidc.circleci.com/org-id"];
    v.circleProjectId = config.claims["oidc.circleci.com/project-id"];
    v.pipelineDefinitionId = config.claims["oidc.circleci.com/pipeline-definition-id"];
    v.contextIds = (config.claims["oidc.circleci.com/context-ids"] ?? []).join(", ");
    v.vcsOrigin = config.claims["oidc.circleci.com/vcs-origin"];
  }
  return v;
}

/** Best-effort current-config lookup for the pre-flight. Never throws — a
 *  failure returns `{ ok: false }` so the caller can fall through to the POST. */
async function listTrustLookup(
  auth: { registry: string; token: string; totpSecret: string },
  name: string,
): Promise<{ ok: true; configs: TrustedPublisherConfig[] } | { ok: false }> {
  try {
    const result = await listTrustedPublishers(auth, name);
    return result.ok ? { ok: true, configs: result.configs } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function removalSnapshotReview(event: PubEvent): {
  complete: boolean;
  hasRemove: boolean;
  allKeep: boolean;
} {
  const snapshot = event.removalSnapshot;
  if (!snapshot) return { complete: false, hasRemove: false, allKeep: false };
  const decisions = event.removalDecisions ?? {};
  return {
    complete: snapshot.every(
      (config) => decisions[config.id] === "remove" || decisions[config.id] === "keep",
    ),
    hasRemove: snapshot.some((config) => decisions[config.id] === "remove"),
    allKeep: snapshot.length > 0 && snapshot.every((config) => decisions[config.id] === "keep"),
  };
}

/**
 * Detect the current git branch for a directory (display-only hint for the
 * publish-branch option). Returns '' when not a git repo or git is missing;
 * the preflight `checkPublishGitState` is the authoritative gate.
 */
async function detectGitBranchSafe(dir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "branch", "--show-current"], {
      maxBuffer: 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/** Handle given to an IPC client so it can be resolved/rejected later. */
export interface PendingClient {
  /** Send a stdout/stderr frame back to the CLI terminal. */
  log(stream: "stdout" | "stderr", data: string): void;
  /** Resolve the CLI with an exit code. */
  exit(code: number, message?: string): void;
}

export type ProactiveEventResult = { ok: true; event: PubEvent } | { ok: false; error: string };

const DETACHED_CLIENT: PendingClient = {
  log: () => {},
  exit: () => {},
};

type PendingPhase = "awaiting-decision" | "executing";

interface PendingEntry {
  event: PubEvent;
  client: PendingClient;
  phase: PendingPhase;
}

interface OidcMemberExit {
  code: number;
  message?: string;
}

/** Resolved metadata about a publish target from a directory or tarball source. */
async function readPublishTarget(source: PublishSource): Promise<Omit<PublishTarget, "path">> {
  try {
    let metadata: unknown;
    if (source.kind === "directory") {
      metadata = JSON.parse(await fsp.readFile(path.join(source.path, "package.json"), "utf8"));
    } else {
      metadata = (await readPackageTarball(source.path)).metadata;
    }
    const pkg = parsePackageMetadata(metadata);
    // repository: prefer the package.json field; fall back to the git remote
    // origin URL (walks up from the source dir to find .git/config).
    let repository = pkg.repository;
    if (!repository && source.kind === "directory") {
      repository = await readGitRemoteUrl(source.path, realFs);
    }
    return {
      name: pkg.name ?? "(unknown)",
      version: pkg.version ?? "0.0.0",
      description: pkg.description,
      ...(repository ? { repository } : {}),
      ...(pkg.publishConfig ? { publishConfig: pkg.publishConfig } : {}),
    };
  } catch {
    return { name: "(unknown)", version: "0.0.0" };
  }
}

function parsePackageMetadata(value: unknown): {
  name?: string;
  version?: string;
  description?: string;
  repository?: string;
  publishConfig?: PublishConfig;
} {
  if (!isRecord(value)) return {};
  const metadata: {
    name?: string;
    version?: string;
    description?: string;
    repository?: string;
    publishConfig?: PublishConfig;
  } = {};
  if (typeof value.name === "string") metadata.name = value.name;
  if (typeof value.version === "string") metadata.version = value.version;
  if (typeof value.description === "string") metadata.description = value.description;
  const repository = parseRepository(value.repository);
  if (repository) metadata.repository = repository;
  const publishConfig = parsePackagePublishConfig(value.publishConfig);
  if (publishConfig) metadata.publishConfig = publishConfig;
  return metadata;
}

/** Resolve which profile a request should use, honoring overrides (Chapter 5.4.5). */
function resolveProfile(store: DaemonStore, override: string | undefined): string {
  if (override && store.getProfile(override)) return override;
  const def = store.getDefault();
  if (def) return def;
  const first = store.getProfiles()[0]?.username;
  return first ?? "";
}

function parseProactivePayload(kind: EventKind, payload: unknown): EventPayload | null {
  switch (kind) {
    case "publish": {
      const data = parsePublishContext(payload);
      return data ? { kind, data } : null;
    }
    case "configure-trust": {
      const data = parseConfigureTrustContext(payload);
      return data ? { kind, data } : null;
    }
    case "create-placeholder": {
      const data = parseCreatePlaceholderContext(payload);
      return data ? { kind, data } : null;
    }
    case "refresh-token": {
      const data = parseRefreshTokenContext(payload);
      return data ? { kind, data } : null;
    }
    case "unpublish": {
      const data = parseUnpublishContext(payload);
      return data ? { kind, data } : null;
    }
    case "recursive-publish": {
      const data = parseRecursivePublishContext(payload);
      return data ? { kind, data } : null;
    }
  }
}

function parsePublishContext(value: unknown): PublishContext | null {
  if (!isRecord(value)) return null;
  const source = parsePublishSource(value.source);
  const target = parsePublishTarget(value.target);
  if (!source || !target) return null;
  const rawArgs = value.args;
  const args =
    Array.isArray(rawArgs) && rawArgs.every((arg) => typeof arg === "string") ? rawArgs : [];
  return { source, args, target };
}

function parseRecursivePublishContext(value: unknown): RecursivePublishContext | null {
  if (!isRecord(value)) return null;
  const source = parsePublishSource(value.source);
  if (!source) return null;
  const rawArgs = value.args;
  const args =
    Array.isArray(rawArgs) && rawArgs.every((arg) => typeof arg === "string") ? rawArgs : [];
  // targets may be empty when created from the WebUI button — they are
  // enumerated via `pnpm pack -r` immediately after creation.
  const rawTargets = Array.isArray(value.targets) ? value.targets : [];
  const targets = rawTargets.map(parsePublishTarget).filter((t): t is PublishTarget => t !== null);
  return { source, args, targets };
}

function parsePublishSource(value: unknown): PublishSource | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  const pathValue = readString(value, "path");
  if ((kind !== "directory" && kind !== "tarball") || !pathValue) return null;
  return { kind, path: pathValue };
}

function parsePublishTarget(value: unknown): PublishTarget | null {
  if (!isRecord(value)) return null;
  const name = readString(value, "name");
  const version = readString(value, "version");
  const pathValue = readString(value, "path");
  if (!name || !version || !pathValue) return null;
  const previousVersion = readString(value, "previousVersion");
  const description = readString(value, "description");
  const repository = readString(value, "repository");
  const publishConfig = parsePackagePublishConfig(value.publishConfig);
  return {
    name,
    version,
    path: pathValue,
    ...(previousVersion ? { previousVersion } : {}),
    ...(description ? { description } : {}),
    ...(repository ? { repository } : {}),
    ...(publishConfig ? { publishConfig } : {}),
  };
}

function isDryRunPublish(args: string[]): boolean {
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--no-dry-run") dryRun = false;
    if (arg.startsWith("--dry-run=")) dryRun = arg.slice("--dry-run=".length) !== "false";
  }
  return dryRun;
}

function isRecursivePublish(args: string[]): boolean {
  let recursive = false;
  for (const arg of args) {
    // pnpm accepts `-r`/`--recursive` and the legacy aliases `-m`/`--multi`.
    if (arg === "-r" || arg === "--recursive" || arg === "-m" || arg === "--multi")
      recursive = true;
    if (arg === "--no-recursive" || arg === "--no-multi") recursive = false;
    if (arg.startsWith("--recursive=")) recursive = arg.slice("--recursive=".length) !== "false";
    if (arg.startsWith("--multi=")) recursive = arg.slice("--multi=".length) !== "false";
  }
  return recursive;
}

function isReportSummaryPublish(args: string[]): boolean {
  let reportSummary = false;
  for (const arg of args) {
    if (arg === "--report-summary") reportSummary = true;
    if (arg === "--no-report-summary") reportSummary = false;
    if (arg.startsWith("--report-summary="))
      reportSummary = arg.slice("--report-summary=".length) !== "false";
  }
  return reportSummary;
}

function isIgnoreScriptsPublish(args: string[]): boolean {
  let ignoreScripts = false;
  for (const arg of args) {
    if (arg === "--ignore-scripts") ignoreScripts = true;
    if (arg === "--no-ignore-scripts") ignoreScripts = false;
    if (arg.startsWith("--ignore-scripts="))
      ignoreScripts = arg.slice("--ignore-scripts=".length) !== "false";
  }
  return ignoreScripts;
}

function isJsonPublish(args: string[]): boolean {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    if (arg === "--no-json") json = false;
    if (arg.startsWith("--json=")) json = arg.slice("--json=".length) !== "false";
  }
  return json;
}

function isFailIfNoMatchPublish(args: string[]): boolean {
  let failIfNoMatch = false;
  for (const arg of args) {
    if (arg === "--fail-if-no-match") failIfNoMatch = true;
    if (arg === "--no-fail-if-no-match") failIfNoMatch = false;
    if (arg.startsWith("--fail-if-no-match="))
      failIfNoMatch = arg.slice("--fail-if-no-match=".length) !== "false";
  }
  return failIfNoMatch;
}

function resolvePublishRegistry(args: string[], defaultRegistry: string): string {
  let registry = defaultRegistry;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--registry") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) registry = next;
      continue;
    }
    if (arg.startsWith("--registry=")) {
      const value = arg.slice("--registry=".length);
      if (value.length > 0) registry = value;
    }
  }
  return registry;
}

function resolvePublishDistTag(args: string[], defaultDistTag?: string): string | undefined {
  let distTag = defaultDistTag;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--tag") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) distTag = next;
      continue;
    }
    if (arg.startsWith("--tag=")) {
      const value = arg.slice("--tag=".length);
      if (value.length > 0) distTag = value;
    }
  }
  return distTag;
}

function resolvePublishAccess(args: string[], defaultAccess?: string): string | undefined {
  let access = defaultAccess;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--access") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) access = next;
      continue;
    }
    if (arg.startsWith("--access=")) {
      const value = arg.slice("--access=".length);
      if (value.length > 0) access = value;
    }
  }
  return access;
}

function resolvePublishOtp(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--otp") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) return next;
      continue;
    }
    if (arg.startsWith("--otp=")) {
      const value = arg.slice("--otp=".length);
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

/** Resolve the `-C`/`--dir <path>` global option (last write wins, like pnpm).
 *  Returns the cwd to publish from, relative to `cwd`. When unset, returns `cwd`. */
function resolvePublishDir(args: string[], cwd: string): string {
  let dir: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-C" || arg === "--dir") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) dir = next;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      const value = arg.slice("--dir=".length);
      if (value.length > 0) dir = value;
      continue;
    }
    if (arg.startsWith("-C=")) {
      const value = arg.slice("-C=".length);
      if (value.length > 0) dir = value;
    }
  }
  return dir ? path.resolve(cwd, dir) : cwd;
}

/** True when the argv requests SLSA provenance (`--provenance` or `--provenance=true`). */
function isProvenancePublish(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--provenance") return true;
    if (arg.startsWith("--provenance=")) return arg.slice("--provenance=".length) !== "false";
  }
  return false;
}

/** Strip `-C`/`--dir` (and its value) from the argv — the daemon sets the
 *  subprocess `cwd` authoritatively, so forwarding the flag would make pnpm
 *  resolve the path a second time. Mirrors `stripOverriddenArgs`. */
function stripDirOverride(args: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "-C" || arg === "--dir") {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("-")) index += 1;
      continue;
    }
    if (arg.startsWith("--dir=") || arg.startsWith("-C=")) continue;
    out.push(arg);
  }
  return out;
}

const PUBLISH_OPTIONS_WITH_VALUE = new Set([
  "--access",
  "--changed-files-ignore-pattern",
  "--dir",
  "--filter",
  "--filter-prod",
  "--loglevel",
  "--otp",
  "--publish-branch",
  "--registry",
  "--reporter",
  "--tag",
  "--test-pattern",
  // Short aliases of value-taking options.
  "-C", // --dir
  "-F", // --filter
]);

function isNativeUnknownCliConfigOption(arg: string): boolean {
  return arg.startsWith("--config.");
}

function formatNativeUnknownCliConfigWarning(arg: string): string {
  const optionName = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
  return `npm warn Unknown cli config "${optionName}". This will stop working in the next major version of npm.\n`;
}

function formatNativeUnknownCliConfigWarnings(args: string[]): string {
  return args
    .filter(isNativeUnknownCliConfigOption)
    .map(formatNativeUnknownCliConfigWarning)
    .join("");
}

function findPublishPositionalArg(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--") {
      return args.slice(index + 1).find((value) => value.length > 0);
    }
    if (PUBLISH_OPTIONS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

async function resolvePublishSource(cwd: string, args: string[]): Promise<PublishSource> {
  if (isRecursivePublish(args)) return { kind: "directory", path: cwd };
  const positional = findPublishPositionalArg(args);
  if (!positional) return { kind: "directory", path: cwd };
  const candidate = path.resolve(cwd, positional);
  const stat = await fsp.stat(candidate).catch(() => null);
  return stat?.isDirectory()
    ? { kind: "directory", path: candidate }
    : { kind: "tarball", path: candidate };
}

async function loadPublishSource(
  source: PublishSource,
  opts: { ignoreScripts?: boolean } = {},
): Promise<{ tarball: Buffer; metadata: Record<string, unknown> }> {
  if (source.kind === "tarball") return readPackageTarball(source.path);
  return opts.ignoreScripts
    ? packPackage(source.path, { ignoreScripts: true })
    : packPackage(source.path);
}

interface PublishedPackageSummary {
  name: string;
  version: string;
}

/** Structural type both the CLI path (`CliPublishResult`) and the API path
 *  (`PublishResult`) satisfy, so `runPublish` can route either uniformly. */
interface PublishResultLike {
  ok: boolean;
  status?: number;
  error?: string;
  clockDriftRecovered?: boolean;
  expired?: boolean;
  stdout: string;
  stderr: string;
}

async function writePublishSummaryFile(
  summaryDir: string,
  publishedPackages: readonly PublishedPackageSummary[],
): Promise<void> {
  await fsp.writeFile(
    path.join(summaryDir, "pnpm-publish-summary.json"),
    JSON.stringify({ publishedPackages }, null, 2) + "\n",
    "utf8",
  );
}

async function writePublishSummary(
  source: PublishSource,
  name: string,
  version: string,
): Promise<void> {
  const summaryDir = source.kind === "directory" ? source.path : path.dirname(source.path);
  await writePublishSummaryFile(summaryDir, [{ name, version }]);
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function publishTarballFilename(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

function formatNpmNoticeLine(text?: string): string {
  return text ? `npm notice ${text}\n` : "npm notice\n";
}

function formatNpmSize(bytes: number): string {
  if (bytes < 1000) return `${bytes}B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)}kB`;
  return `${(bytes / (1000 * 1000)).toFixed(1)}MB`;
}

function shortenIntegrity(integrity: string): string {
  if (integrity.length <= 46) return integrity;
  return `${integrity.slice(0, 20)}[...]${integrity.slice(-18)}`;
}

function normalizeRegistryForNotice(registry: string): string {
  return registry.endsWith("/") ? registry : `${registry}/`;
}

function formatDryRunPublishDestinationNotice(params: {
  registry: string;
  distTag?: string;
  access?: string;
}): string {
  const accessText = params.access ? `${params.access} access` : "default access";
  return formatNpmNoticeLine(
    `Publishing to ${normalizeRegistryForNotice(params.registry)} with tag ${params.distTag ?? "latest"} and ${accessText} (dry-run)`,
  );
}

interface PublishJsonProjection {
  id: string;
  name: string;
  version: string;
  size: number;
  unpackedSize?: number;
  shasum: string;
  integrity: string;
  filename: string;
  files?: PackageTarballFile[];
  entryCount?: number;
  bundled?: string[];
}

async function buildPublishJsonProjection(
  name: string,
  version: string,
  tarball: Buffer,
  /** Pre-computed summary (avoids a second packer pass when the caller already has one). */
  existingSummary?: PackageTarballSummary | null,
): Promise<PublishJsonProjection> {
  const summary =
    existingSummary !== undefined
      ? existingSummary
      : await summarizePackageTarball(tarball).catch(() => null);
  return {
    id: `${name}@${version}`,
    name,
    version,
    size: tarball.length,
    ...(summary
      ? {
          unpackedSize: summary.unpackedSize,
        }
      : {}),
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
    filename: publishTarballFilename(name, version),
    ...(summary
      ? {
          files: summary.files,
          entryCount: summary.entryCount,
          bundled: summary.bundled,
        }
      : {}),
  };
}

async function formatPublishJson(
  name: string,
  version: string,
  tarball: Buffer,
  existingSummary?: PackageTarballSummary | null,
): Promise<string> {
  const projection = await buildPublishJsonProjection(name, version, tarball, existingSummary);
  return JSON.stringify(projection, null, 2) + "\n";
}

async function formatDryRunNpmNotice(params: {
  name: string;
  version: string;
  tarball: Buffer;
  registry: string;
  distTag?: string;
  access?: string;
  /** Pre-computed summary (avoids a second packer pass when the caller already has one). */
  summary?: PackageTarballSummary | null;
}): Promise<string> {
  const summary =
    params.summary !== undefined
      ? params.summary
      : await summarizePackageTarball(params.tarball).catch(() => null);
  if (!summary) return "";
  const shasum = createHash("sha1").update(params.tarball).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(params.tarball).digest("base64")}`;
  const bundledLines =
    summary.bundled.length > 0
      ? [
          formatNpmNoticeLine("Bundled Dependencies"),
          ...summary.bundled.map((dependency) => formatNpmNoticeLine(dependency)),
        ]
      : [];
  const bundledDetailLines =
    summary.bundled.length > 0
      ? [
          formatNpmNoticeLine(`bundled deps: ${summary.bundled.length}`),
          formatNpmNoticeLine("bundled files: 0"),
          formatNpmNoticeLine(`own files: ${summary.entryCount}`),
        ]
      : [];
  const lines: string[] = [
    formatNpmNoticeLine(),
    formatNpmNoticeLine(`\u{1F4E6}  ${params.name}@${params.version}`),
    formatNpmNoticeLine("Tarball Contents"),
    ...summary.files.map((file) => formatNpmNoticeLine(`${formatNpmSize(file.size)} ${file.path}`)),
    ...bundledLines,
    formatNpmNoticeLine("Tarball Details"),
    formatNpmNoticeLine(`name: ${params.name}`),
    formatNpmNoticeLine(`version: ${params.version}`),
    formatNpmNoticeLine(`filename: ${publishTarballFilename(params.name, params.version)}`),
    formatNpmNoticeLine(
      `package size: ${formatNpmSize(params.tarball.length).replace(/([A-Za-z]+)$/, " $1")}`,
    ),
    formatNpmNoticeLine(
      `unpacked size: ${formatNpmSize(summary.unpackedSize).replace(/([A-Za-z]+)$/, " $1")}`,
    ),
    formatNpmNoticeLine(`shasum: ${shasum}`),
    formatNpmNoticeLine(`integrity: ${shortenIntegrity(integrity)}`),
    ...bundledDetailLines,
    formatNpmNoticeLine(`total files: ${summary.entryCount}`),
    formatNpmNoticeLine(),
    formatDryRunPublishDestinationNotice(params),
  ];
  return lines.join("");
}

type RecursiveFilterEdgeKind = "all" | "production";

interface RecursiveFilter {
  value: string;
  edgeKind: RecursiveFilterEdgeKind;
}

function readRecursiveFilters(args: string[]): RecursiveFilter[] {
  const filters: RecursiveFilter[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--filter" || arg === "-F") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        filters.push({ value: next, edgeKind: "all" });
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--filter=")) {
      const value = arg.slice("--filter=".length);
      if (value.length > 0) filters.push({ value, edgeKind: "all" });
      continue;
    }
    if (arg.startsWith("-F=")) {
      const value = arg.slice("-F=".length);
      if (value.length > 0) filters.push({ value, edgeKind: "all" });
      continue;
    }
    if (arg === "--filter-prod") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        filters.push({ value: next, edgeKind: "production" });
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--filter-prod=")) {
      const value = arg.slice("--filter-prod=".length);
      if (value.length > 0) filters.push({ value, edgeKind: "production" });
    }
  }
  return filters;
}

function readChangedFilesIgnorePatterns(args: string[]): string[] {
  const patterns: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--changed-files-ignore-pattern") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        patterns.push(next);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--changed-files-ignore-pattern=")) {
      const value = arg.slice("--changed-files-ignore-pattern=".length);
      if (value.length > 0) patterns.push(value);
    }
  }
  return patterns;
}

interface RecursiveSelectorParts {
  packageSelector?: string;
  directorySelector?: string;
  changedSinceRef?: string;
}

interface RecursiveFilterContext<T extends { path: string }> {
  root: string;
  packages: T[];
  changedPathsByRef: Map<string, Promise<Set<string>>>;
  changedFilesIgnorePatterns: readonly string[];
  currentPackagePath?: string;
}

function parseRecursiveSelector(value: string): RecursiveSelectorParts {
  const trimmed = value.trim();
  const changedSince = parseChangedSinceSuffix(trimmed);
  const selectorText = changedSince.selector;
  const openIndex = selectorText.lastIndexOf("{");
  if (openIndex >= 0 && selectorText.endsWith("}") && openIndex < selectorText.length - 2) {
    const packageSelector = selectorText.slice(0, openIndex);
    const directorySelector = selectorText.slice(openIndex + 1, -1);
    return {
      ...(packageSelector ? { packageSelector } : {}),
      directorySelector,
      ...(changedSince.ref ? { changedSinceRef: changedSince.ref } : {}),
    };
  }
  return {
    ...(selectorText ? { packageSelector: selectorText } : {}),
    ...(changedSince.ref ? { changedSinceRef: changedSince.ref } : {}),
  };
}

function parseChangedSinceSuffix(value: string): { selector: string; ref?: string } {
  const openIndex = value.lastIndexOf("[");
  if (openIndex >= 0 && value.endsWith("]") && openIndex < value.length - 2) {
    return {
      selector: value.slice(0, openIndex),
      ref: value.slice(openIndex + 1, -1),
    };
  }
  return { selector: value };
}

function normalizeRelativeFilter(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function filterToRegExp(value: string): RegExp {
  const escaped = normalizeRelativeFilter(value)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function selectorTextMatches(selector: string, value: string): boolean {
  const normalized = normalizeRelativeFilter(selector);
  if (!normalized) return false;
  if (value === selector || value === normalized) return true;
  if (!normalized.includes("*")) return false;
  return filterToRegExp(normalized).test(value);
}

function packageContainsRelativeFile(root: string, pkgPath: string, file: string): boolean {
  const relativePackagePath = path.relative(root, pkgPath).replace(/\\/g, "/");
  return (
    relativePackagePath.length === 0 ||
    file === relativePackagePath ||
    file.startsWith(`${relativePackagePath}/`)
  );
}

function findCurrentPackagePath<T extends { path: string }>(
  root: string,
  packages: T[],
  currentPath: string,
): string | undefined {
  const relativeCurrentPath = path.relative(root, currentPath).replace(/\\/g, "/");
  const packageOrder = [...packages].sort((left, right) => {
    const leftRelative = path.relative(root, left.path);
    const rightRelative = path.relative(root, right.path);
    return rightRelative.length - leftRelative.length;
  });
  return packageOrder.find((pkg) =>
    packageContainsRelativeFile(root, pkg.path, relativeCurrentPath),
  )?.path;
}

function changedFileIsIgnored(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => selectorTextMatches(pattern, file));
}

async function readChangedPackagePaths<T extends { path: string }>(
  root: string,
  packages: T[],
  ref: string,
  ignorePatterns: readonly string[],
): Promise<Set<string>> {
  let stdout = "";
  try {
    const result = await execFileAsync("git", ["-C", root, "diff", "--name-only", ref, "--"], {
      maxBuffer: 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    return new Set();
  }
  const packageOrder = [...packages].sort((left, right) => {
    const leftRelative = path.relative(root, left.path);
    const rightRelative = path.relative(root, right.path);
    return rightRelative.length - leftRelative.length;
  });
  const changed = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const file = normalizeRelativeFilter(line);
    if (!file) continue;
    if (changedFileIsIgnored(file, ignorePatterns)) continue;
    const owner = packageOrder.find((pkg) => packageContainsRelativeFile(root, pkg.path, file));
    if (owner) changed.add(owner.path);
  }
  return changed;
}

async function getChangedPackagePaths<T extends { path: string }>(
  context: RecursiveFilterContext<T>,
  ref: string,
): Promise<Set<string>> {
  const existing = context.changedPathsByRef.get(ref);
  if (existing) return existing;
  const pending = readChangedPackagePaths(
    context.root,
    context.packages,
    ref,
    context.changedFilesIgnorePatterns,
  );
  context.changedPathsByRef.set(ref, pending);
  return pending;
}

function selectorMatchesPackage<T extends { path: string }>(
  selector: string,
  pkg: T,
  context: RecursiveFilterContext<T>,
): boolean {
  if (selector.trim() === "." || selector.trim() === "./") {
    return context.currentPackagePath === pkg.path;
  }
  return selectorTextMatches(
    selector,
    "name" in pkg && typeof pkg.name === "string" ? pkg.name : "",
  );
}

async function recursiveFilterMatches<T extends { name: string; path: string }>(
  filter: string,
  pkg: T,
  context: RecursiveFilterContext<T>,
): Promise<boolean> {
  const selector = parseRecursiveSelector(filter);
  const changedMatches = selector.changedSinceRef
    ? (await getChangedPackagePaths(context, selector.changedSinceRef)).has(pkg.path)
    : true;
  if (!changedMatches) return false;
  const relativePath = path.relative(context.root, pkg.path).replace(/\\/g, "/");
  if (selector.directorySelector) {
    const directoryMatches = selectorTextMatches(selector.directorySelector, relativePath);
    if (!directoryMatches) return false;
    return selector.packageSelector
      ? selectorMatchesPackage(selector.packageSelector, pkg, context)
      : true;
  }
  return selector.packageSelector
    ? selectorMatchesPackage(selector.packageSelector, pkg, context) ||
        selectorTextMatches(selector.packageSelector, relativePath)
    : Boolean(selector.changedSinceRef);
}

function appendUniquePackage<T extends { name: string }>(
  out: T[],
  seen: Set<string>,
  pkg: T,
): void {
  if (seen.has(pkg.name)) return;
  seen.add(pkg.name);
  out.push(pkg);
}

interface RecursiveGraphPackage {
  name: string;
  path: string;
  dependencyNames?: string[];
  productionDependencyNames?: string[];
}

function readGraphDependencyNames(
  pkg: RecursiveGraphPackage,
  edgeKind: RecursiveFilterEdgeKind,
): readonly string[] {
  return edgeKind === "production"
    ? (pkg.productionDependencyNames ?? [])
    : (pkg.dependencyNames ?? []);
}

function appendDependencyClosure<T extends RecursiveGraphPackage>(
  out: T[],
  seen: Set<string>,
  pkg: T,
  byName: Map<string, T>,
  includeSelf: boolean,
  visiting: Set<string>,
  edgeKind: RecursiveFilterEdgeKind,
): void {
  if (visiting.has(pkg.name)) return;
  visiting.add(pkg.name);
  for (const dependencyName of readGraphDependencyNames(pkg, edgeKind)) {
    const dependency = byName.get(dependencyName);
    if (dependency)
      appendDependencyClosure(out, seen, dependency, byName, true, visiting, edgeKind);
  }
  visiting.delete(pkg.name);
  if (includeSelf) appendUniquePackage(out, seen, pkg);
}

function appendDependentClosure<T extends RecursiveGraphPackage>(
  out: T[],
  seen: Set<string>,
  pkg: T,
  packages: T[],
  includeSelf: boolean,
  visiting: Set<string>,
  edgeKind: RecursiveFilterEdgeKind,
): void {
  if (includeSelf) appendUniquePackage(out, seen, pkg);
  if (visiting.has(pkg.name)) return;
  visiting.add(pkg.name);
  for (const candidate of packages) {
    if (!readGraphDependencyNames(candidate, edgeKind).includes(pkg.name)) continue;
    appendDependentClosure(out, seen, candidate, packages, true, visiting, edgeKind);
  }
  visiting.delete(pkg.name);
}

async function matchingPackages<T extends RecursiveGraphPackage>(
  packages: T[],
  filter: string,
  context: RecursiveFilterContext<T>,
): Promise<T[]> {
  const matched: T[] = [];
  for (const pkg of packages) {
    if (await recursiveFilterMatches(filter, pkg, context)) matched.push(pkg);
  }
  return matched;
}

class RecursiveSelectorError extends Error {}

function unsupportedBareGraphSelectorDescriptor(
  value: string,
  edgeKind: RecursiveFilterEdgeKind,
): string | undefined {
  const followProdDepsOnly = edgeKind === "production" ? "true" : "false";
  switch (value) {
    case "...":
      return `{"exclude":false,"excludeSelf":false,"includeDependencies":true,"includeDependents":false,"followProdDepsOnly":${followProdDepsOnly}}`;
    case "^...":
      return `{"exclude":false,"excludeSelf":true,"includeDependencies":true,"includeDependents":false,"followProdDepsOnly":${followProdDepsOnly}}`;
    case "...^":
      return `{"exclude":false,"excludeSelf":true,"includeDependencies":false,"includeDependents":true,"followProdDepsOnly":${followProdDepsOnly}}`;
    case "......":
      return `{"exclude":false,"excludeSelf":false,"includeDependencies":true,"includeDependents":true,"followProdDepsOnly":${followProdDepsOnly}}`;
    case "...^...":
      return `{"exclude":false,"excludeSelf":true,"includeDependencies":true,"includeDependents":true,"followProdDepsOnly":${followProdDepsOnly}}`;
    default:
      return undefined;
  }
}

function assertSupportedRecursiveSelector(filter: RecursiveFilter): void {
  const descriptor = unsupportedBareGraphSelectorDescriptor(filter.value, filter.edgeKind);
  if (!descriptor) return;
  throw new RecursiveSelectorError(`ERROR Unsupported package selector: ${descriptor}`);
}

function normalizeCombinedGraphSeedFilter(value: string): string {
  let seed = value;
  if (seed.startsWith("^")) seed = seed.slice(1);
  if (seed.endsWith("^")) seed = seed.slice(0, -1);
  return seed;
}

function isCurrentProjectGraphSelector(value: string): boolean {
  return (
    value === "./..." ||
    value === "...." ||
    value === ".^..." ||
    value === "./^..." ||
    value === "...^." ||
    value === "...^./"
  );
}

async function expandRecursiveFilter<T extends RecursiveGraphPackage>(
  packages: T[],
  filter: RecursiveFilter,
  context: RecursiveFilterContext<T>,
): Promise<T[]> {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const out: T[] = [];
  const seen = new Set<string>();
  assertSupportedRecursiveSelector(filter);
  if (isCurrentProjectGraphSelector(filter.value)) {
    return matchingPackages(packages, ".", context);
  }
  if (
    filter.value.startsWith("...") &&
    filter.value.endsWith("...") &&
    filter.value.length > "......".length
  ) {
    const seedFilter = normalizeCombinedGraphSeedFilter(
      filter.value.slice("...".length, filter.value.length - "...".length),
    );
    for (const seed of await matchingPackages(packages, seedFilter, context)) {
      appendDependencyClosure(out, seen, seed, byName, true, new Set(), filter.edgeKind);
      appendDependentClosure(out, seen, seed, packages, false, new Set(), filter.edgeKind);
    }
    return out;
  }
  if (filter.value.startsWith("...^")) {
    const seedFilter = filter.value.slice("...^".length);
    for (const seed of await matchingPackages(packages, seedFilter, context)) {
      appendDependentClosure(out, seen, seed, packages, false, new Set(), filter.edgeKind);
    }
    return out;
  }
  if (filter.value.startsWith("...")) {
    const seedFilter = filter.value.slice("...".length);
    for (const seed of await matchingPackages(packages, seedFilter, context)) {
      appendDependentClosure(out, seen, seed, packages, true, new Set(), filter.edgeKind);
    }
    return out;
  }
  if (filter.value.endsWith("^...")) {
    const seedFilter = filter.value.slice(0, filter.value.length - "^...".length);
    for (const seed of await matchingPackages(packages, seedFilter, context)) {
      appendDependencyClosure(out, seen, seed, byName, false, new Set(), filter.edgeKind);
    }
    return out;
  }
  if (filter.value.endsWith("...")) {
    const seedFilter = filter.value.slice(0, filter.value.length - "...".length);
    for (const seed of await matchingPackages(packages, seedFilter, context)) {
      appendDependencyClosure(out, seen, seed, byName, true, new Set(), filter.edgeKind);
    }
    return out;
  }
  return matchingPackages(packages, filter.value, context);
}

function splitRecursiveFilters(filters: RecursiveFilter[]): {
  include: RecursiveFilter[];
  exclude: RecursiveFilter[];
} {
  const include: RecursiveFilter[] = [];
  const exclude: RecursiveFilter[] = [];
  for (const filter of filters) {
    if (filter.value.startsWith("!")) {
      const value = filter.value.slice(1);
      if (value.length > 0) exclude.push({ value, edgeKind: filter.edgeKind });
      continue;
    }
    include.push(filter);
  }
  return { include, exclude };
}

async function applyRecursiveFilters<T extends RecursiveGraphPackage>(
  packages: T[],
  root: string,
  filters: RecursiveFilter[],
  changedFilesIgnorePatterns: readonly string[] = [],
  currentPath?: string,
): Promise<T[]> {
  if (filters.length === 0) return packages;
  const { include, exclude } = splitRecursiveFilters(filters);
  const context: RecursiveFilterContext<T> = {
    root,
    packages,
    changedPathsByRef: new Map(),
    changedFilesIgnorePatterns,
    ...(currentPath
      ? { currentPackagePath: findCurrentPackagePath(root, packages, currentPath) }
      : {}),
  };
  const included: T[] = [];
  const includedSeen = new Set<string>();
  if (include.length === 0) {
    for (const pkg of packages) appendUniquePackage(included, includedSeen, pkg);
  } else {
    for (const filter of include) {
      for (const pkg of await expandRecursiveFilter(packages, filter, context))
        appendUniquePackage(included, includedSeen, pkg);
    }
  }
  const excluded = new Set<string>();
  for (const filter of exclude) {
    for (const pkg of await expandRecursiveFilter(packages, filter, context))
      excluded.add(pkg.name);
  }
  return exclude.length === 0 ? included : included.filter((pkg) => !excluded.has(pkg.name));
}

async function resolveRecursivePublishRoot(source: PublishSource): Promise<string> {
  const start = source.kind === "directory" ? source.path : path.dirname(source.path);
  const found = await findProjectRoot(start, realFs);
  return found.root ?? start;
}

function parseTrustedPublisherCreateConfig(
  value: unknown,
): TrustedPublisherCreateConfig | undefined {
  if (value === undefined) return undefined;
  const result = TrustedPublisherCreateConfigSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function parseTrustedPublisherConfig(value: unknown): TrustedPublisherConfig | undefined {
  if (value === undefined) return undefined;
  const result = TrustedPublisherConfigSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function parseTrustedPublishingTarget(value: unknown): TrustedPublishingTarget | null {
  if (!isRecord(value)) return null;
  const name = readString(value, "name");
  if (!name) return null;
  const pathValue = readString(value, "path");
  const repository = readString(value, "repository");
  const currentConfig = parseTrustedPublisherConfig(value.currentConfig);
  return {
    name,
    ...(pathValue ? { path: pathValue } : {}),
    ...(repository ? { repository } : {}),
    ...(currentConfig ? { currentConfig } : {}),
  };
}

function parseConfigureTrustContext(value: unknown): ConfigureTrustContext | null {
  if (!isRecord(value)) return null;
  const action = value.action;
  if (action !== "add" && action !== "update" && action !== "remove") return null;
  const target = parseTrustedPublishingTarget(value.target);
  if (!target) return null;
  const config = parseTrustedPublisherCreateConfig(value.config);
  return { action, target, ...(config ? { config } : {}) };
}

function parseCreatePlaceholderContext(value: unknown): CreatePlaceholderContext | null {
  if (!isRecord(value)) return null;
  const name = readString(value, "name");
  if (!name) return null;
  return { name };
}

function parseRefreshTokenContext(value: unknown): RefreshTokenContext | null {
  if (!isRecord(value)) return null;
  const username = readString(value, "username");
  return username ? { username } : null;
}

function parseUnpublishContext(value: unknown): UnpublishContext | null {
  if (!isRecord(value)) return null;
  const name = readString(value, "name");
  const version = readString(value, "version");
  if (!name || !version) return null;
  return { name, version };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasOidcConfigInput(req: IpcOidcRequest): boolean {
  return (
    req.provider !== undefined ||
    req.repo !== undefined ||
    req.file !== undefined ||
    req.env !== undefined ||
    req.projectPath !== undefined ||
    req.ciFile !== undefined ||
    req.circleOrgId !== undefined ||
    req.circleProjectId !== undefined ||
    req.circlePipelineDefinitionId !== undefined ||
    req.circleContextIds !== undefined ||
    req.vcsOrigin !== undefined ||
    req.allowPublish !== undefined ||
    req.allowStagePublish !== undefined
  );
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function oidcPermissions(
  req: IpcOidcRequest,
): { ok: true; permissions: TrustedPublisherPermission[] } | { ok: false; error: string } {
  const permissions: TrustedPublisherPermission[] = [];
  if (req.allowPublish ?? true) permissions.push("createPackage");
  if (req.allowStagePublish ?? true) permissions.push("createStagedPackage");
  if (permissions.length === 0) {
    return { ok: false, error: "At least one OIDC permission must stay enabled." };
  }
  return { ok: true, permissions };
}

function createOidcConfig(
  req: IpcOidcRequest,
  targets: TrustedPublishingTarget[],
): { ok: true; config?: TrustedPublisherCreateConfig } | { ok: false; error: string } {
  if (!hasOidcConfigInput(req)) return { ok: true };
  if (req.remove) {
    return { ok: false, error: "Provider config flags cannot be combined with --remove." };
  }
  const permissions = oidcPermissions(req);
  if (!permissions.ok) return permissions;
  const provider = req.provider ?? "github";
  if (provider === "github") {
    const repository = trimOptional(req.repo) ?? commonRepoSlug(targets, "github");
    const file = trimOptional(req.file);
    if (!repository) return { ok: false, error: "GitHub OIDC requires --repo <owner/repo>." };
    if (!file) return { ok: false, error: "GitHub OIDC requires --file <workflow.yml>." };
    const environment = trimOptional(req.env);
    return {
      ok: true,
      config: {
        type: "github",
        permissions: permissions.permissions,
        claims: {
          repository,
          workflow_ref: { file },
          ...(environment ? { environment } : {}),
        },
      },
    };
  }
  if (provider === "gitlab") {
    const projectPath = trimOptional(req.projectPath) ?? commonRepoSlug(targets, "gitlab");
    if (!projectPath) {
      return { ok: false, error: "GitLab OIDC requires --project-path <group/project>." };
    }
    const ciFile = trimOptional(req.ciFile);
    const environment = trimOptional(req.env);
    return {
      ok: true,
      config: {
        type: "gitlab",
        permissions: permissions.permissions,
        claims: {
          project_path: projectPath,
          ...(ciFile ? { ci_config_ref_uri: ciFile } : {}),
          ...(environment ? { environment } : {}),
        },
      },
    };
  }
  const orgId = trimOptional(req.circleOrgId);
  const projectId = trimOptional(req.circleProjectId);
  const pipelineDefinitionId = trimOptional(req.circlePipelineDefinitionId);
  const vcsOrigin = trimOptional(req.vcsOrigin);
  if (!orgId || !projectId || !pipelineDefinitionId || !vcsOrigin) {
    return {
      ok: false,
      error:
        "CircleCI OIDC requires --circle-org-id, --circle-project-id, --circle-pipeline-definition-id, and --vcs-origin.",
    };
  }
  const contextIds = (req.circleContextIds ?? []).map((item) => item.trim()).filter(Boolean);
  return {
    ok: true,
    config: {
      type: "circleci",
      permissions: permissions.permissions,
      claims: {
        "oidc.circleci.com/org-id": orgId,
        "oidc.circleci.com/project-id": projectId,
        "oidc.circleci.com/pipeline-definition-id": pipelineDefinitionId,
        ...(contextIds.length > 0 ? { "oidc.circleci.com/context-ids": contextIds } : {}),
        "oidc.circleci.com/vcs-origin": vcsOrigin,
      },
    },
  };
}

function commonRepoSlug(
  targets: TrustedPublishingTarget[],
  provider: "github" | "gitlab",
): string | undefined {
  const slugs = targets.map((target) =>
    target.repository ? repoSlugFromHint(target.repository, provider) : undefined,
  );
  if (slugs.some((slug) => !slug)) return undefined;
  const unique = new Set(slugs.filter((slug): slug is string => slug !== undefined));
  return unique.size === 1 ? [...unique][0] : undefined;
}

function repoSlugFromHint(hint: string, provider: "github" | "gitlab"): string | undefined {
  const host = provider === "github" ? "github.com" : "gitlab.com";
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trimmed = hint.trim().replace(/\.git$/i, "");
  const hostMatch =
    trimmed.match(new RegExp(`${escapedHost}[:/]([^\\s]+)$`, "i")) ??
    trimmed.match(new RegExp(`git@${escapedHost}:([^\\s]+)$`, "i"));
  const pathPart = hostMatch?.[1] ?? (/^[\w.-]+\/[\w.@/-]+$/.test(trimmed) ? trimmed : "");
  const pieces = pathPart
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (pieces.length < 2) return undefined;
  return pieces.join("/");
}

export class PublishScheduler {
  /** taskId -> live task handle. `executing` entries own an external effect. */
  private pending = new Map<string, PendingEntry>();

  constructor(private store: DaemonStore) {}

  private async collectWorkspaceFromCwd(cwd: string, client: PendingClient): Promise<void> {
    try {
      const found = await findProjectRoot(cwd, realFs);
      if (!found.root || isRiskyRoot(found.root, realFs)) {
        client.log(
          "stderr",
          `[workspace] skipped auto-collect for risky path: ${found.root ?? cwd}\n`,
        );
        return;
      }
      await this.store.addWorkspace({ path: found.root, pinned: false, addedAt: Date.now() });
    } catch (error: unknown) {
      const message = errorToMessage(error);
      client.log("stderr", `[workspace] failed to auto-collect ${cwd}: ${message}\n`);
    }
  }

  /**
   * Step 1 (Chapter 3.3.1 / 8.3.5): a CLI publish intent arrives. We freeze it
   * as a pending event and register the waiting client. The WebUI is notified
   * via the store's `event` emitter (consumed by the WS bridge).
   */
  async intercept(req: IpcPublishRequest, client: PendingClient): Promise<PubEvent | undefined> {
    // Chapter 5.4.5: an explicit --profile override MUST be honored strictly.
    // If the named profile does not exist, fail loudly — never silently fall
    // back to the default identity (that would be the "身份割裂" the spec forbids).
    if (req.profileOverride && req.profileOverride.length > 0) {
      if (!this.store.getProfile(req.profileOverride)) {
        const msg = `Profile "${req.profileOverride}" not found. Add it via the tray GUI first.`;
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
        return undefined;
      }
    }
    const profile = resolveProfile(this.store, req.profileOverride);
    if (!profile) {
      client.log("stderr", "No profile configured. Add a profile via the tray GUI first.\n");
      client.exit(1, "No profile");
      return undefined;
    }
    // Chapter 7.1.2 — drop-in parity: unknown flags are forwarded verbatim to
    // `pnpm publish`. pnpm-pub only intercepts the flags it routes on
    // (--recursive/--dry-run/--access/--tag/--filter/...); everything else is
    // the user's responsibility and pnpm will report any genuine errors.
    // The global `-C`/`--dir <path>` overrides the publish cwd (like pnpm); we
    // resolve it here and strip it from the forwarded argv so pnpm does not
    // re-resolve it against the already-set subprocess cwd.
    const effectiveCwd = resolvePublishDir(req.args, req.cwd);
    const publishArgs = effectiveCwd === req.cwd ? req.args : stripDirOverride(req.args);
    if (isProvenancePublish(publishArgs)) {
      client.log(
        "stderr",
        "> note: --provenance passed through to pnpm. SLSA provenance normally requires a supported CI (GitHub Actions) with OIDC. For trusted publishing from CI, use pnpm-pub's Trusted Publishing Event flow.\n",
      );
    }
    await this.collectWorkspaceFromCwd(effectiveCwd, client);
    const source = await resolvePublishSource(effectiveCwd, publishArgs);

    // Recursive non-dry-run publish is its own event kind: it requires pnpm
    // (no API fallback) and carries multiple targets enumerated via
    // `pnpm list -r`. Dry-run recursive still uses the single-package event
    // path (runRecursivePublishDryRun).
    const isRecursive = isRecursivePublish(publishArgs);
    const isDryRun = isDryRunPublish(publishArgs);
    if (isRecursive && !isDryRun) {
      // Recursive publish REQUIRES pnpm — refuse early (no event, no fallback).
      if (!(await hasPnpm(source.path))) {
        const msg = "Recursive publish requires pnpm on PATH; no fallback is available.";
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
        return undefined;
      }
      let targets: PublishTarget[];
      try {
        targets = await this.enumerateRecursiveTargets(source.path, publishArgs, client);
      } catch (error: unknown) {
        const msg = errorToMessage(error);
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
        return undefined;
      }
      if (targets.length === 0) {
        const msg = "No publishable packages matched in the workspace.";
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
        return undefined;
      }
      const branch = await detectGitBranchSafe(source.path);
      const event = this.store.createEvent({
        kind: "recursive-publish",
        profile,
        profileOverride: req.profileOverride,
        payload: {
          kind: "recursive-publish",
          data: {
            source,
            args: publishArgs,
            targets,
            ...(branch ? { branch } : {}),
          },
        },
      });
      this.pending.set(event.id, { event, client, phase: "awaiting-decision" });
      // Prefetch per-target tarball previews (best-effort, non-blocking) so the
      // confirm card's target list can show each package's file tree during the
      // pending phase and persist it for later review.
      void this.prefetchRecursiveSummaries(event.id, targets);
      return event;
    }

    const target = await readPublishTarget(source);
    // Detect the current git branch from the source dir to surface a hint for
    // the publish-branch option in the EventCard. The preflight
    // (checkPublishGitState) is authoritative; this is display-only.
    const branch = await detectGitBranchSafe(source.path);
    const event = this.store.createEvent({
      kind: "publish",
      profile,
      profileOverride: req.profileOverride,
      payload: {
        kind: "publish",
        data: {
          source,
          args: publishArgs,
          target: { ...target, path: source.path },
          ...(branch ? { branch } : {}),
        },
      },
    });
    this.pending.set(event.id, { event, client, phase: "awaiting-decision" });
    // The WS bridge listens on the store and will notify every WebUI client.
    // Prefetch the tarball preview (best-effort, non-blocking) so the confirm
    // card shows the file tree during the pending phase and it persists for
    // later review. Only directory sources can be dry-run packed.
    if (source.kind === "directory") {
      void this.prefetchPublishSummary(event.id, source.path);
    }
    return event;
  }

  /**
   * CLI-originated Trusted Publishing intent. This only creates pending
   * configure-trust Event(s); npm /trust writes still require WebUI
   * confirmation through confirm().
   */
  async createOidcEvents(
    req: IpcOidcRequest,
    client: PendingClient,
  ): Promise<PubEvent[] | undefined> {
    if (req.profileOverride && req.profileOverride.length > 0) {
      if (!this.store.getProfile(req.profileOverride)) {
        const msg = `Profile "${req.profileOverride}" not found. Add it via the tray GUI first.`;
        this.exitOidcRequest(req, client, 1, msg);
        return undefined;
      }
    }
    const profile = resolveProfile(this.store, req.profileOverride);
    if (!profile) {
      this.exitOidcRequest(
        req,
        client,
        1,
        "No profile configured. Add a profile via the tray GUI first.",
      );
      return undefined;
    }

    await this.collectWorkspaceFromCwd(req.cwd, req.json ? DETACHED_CLIENT : client);
    const targets = await this.resolveOidcTargets(req);
    if (!targets.ok) {
      this.exitOidcRequest(req, client, 1, targets.error);
      return undefined;
    }
    const config = createOidcConfig(req, targets.targets);
    if (!config.ok) {
      this.exitOidcRequest(req, client, 1, config.error);
      return undefined;
    }
    const removalSnapshots = req.remove
      ? await this.captureRemovalSnapshots(profile, targets.targets)
      : { ok: true as const, snapshots: [] };
    if (!removalSnapshots.ok) {
      this.exitOidcRequest(req, client, 1, removalSnapshots.error);
      return undefined;
    }
    const groupId = targets.targets.length > 1 ? randomUUID() : undefined;
    const events: PubEvent[] = [];
    for (const [index, target] of targets.targets.entries()) {
      const action = req.remove ? "remove" : "add";
      const data: ConfigureTrustContext = {
        action,
        target,
        ...(!groupId && config.config && !req.remove ? { config: config.config } : {}),
        ...(targets.root ? { root: targets.root } : {}),
      };
      const event = this.store.createEvent({
        kind: "configure-trust",
        profile,
        profileOverride: req.profileOverride,
        payload: { kind: "configure-trust", data },
        ...(groupId ? { groupId } : {}),
        ...(req.remove ? { removalSnapshot: removalSnapshots.snapshots[index] ?? [] } : {}),
      });
      events.push(event);
    }
    const memberClients = this.createOidcRequestClients(events, client, req.json ?? false);
    for (const event of events) {
      this.pending.set(event.id, {
        event,
        client: memberClients.get(event.id) ?? client,
        phase: "awaiting-decision",
      });
    }
    if (groupId && config.config && !req.remove) {
      this.store.updateConfigureTrustGroupDraft(groupId, config.config);
    }

    if (!req.json) {
      client.log(
        "stdout",
        `[oidc] created ${events.length} Trusted Publishing Event${events.length === 1 ? "" : "s"}. Confirm in the tray.\n`,
      );
    }
    return events;
  }

  private exitOidcRequest(
    req: Pick<IpcOidcRequest, "json">,
    client: PendingClient,
    code: number,
    message: string,
  ): void {
    if (req.json) {
      client.log(
        "stdout",
        JSON.stringify({ ok: false, command: "oidc", error: message, events: [] }, null, 2) + "\n",
      );
    } else {
      client.log("stderr", message + "\n");
    }
    client.exit(code, message);
  }

  private createOidcRequestClients(
    events: PubEvent[],
    client: PendingClient,
    json: boolean,
  ): Map<string, PendingClient> {
    const exits = new Map<string, OidcMemberExit>();
    const logs: { eventId: string; stream: "stdout" | "stderr"; data: string }[] = [];
    let terminalSent = false;
    const eventIds = events.map((event) => event.id);

    const eventResult = (event: PubEvent, exit: OidcMemberExit | undefined) => {
      const current = this.store.getEvent(event.id) ?? event;
      const data = current.payload?.kind === "configure-trust" ? current.payload.data : undefined;
      return {
        id: current.id,
        status: current.status,
        action: data?.action,
        target: data?.target.name,
        result: current.result,
        code: exit?.code,
        message: exit?.message,
      };
    };

    const finishIfDone = (): void => {
      if (terminalSent || exits.size < events.length) return;
      terminalSent = true;
      const results = events.map((event) => eventResult(event, exits.get(event.id)));
      const exitCode = results.some((result) => (result.code ?? 1) !== 0) ? 1 : 0;
      if (json) {
        client.log(
          "stdout",
          JSON.stringify(
            {
              ok: exitCode === 0,
              command: "oidc",
              eventIds,
              groupId: events[0]?.groupId,
              events: results,
              logs,
            },
            null,
            2,
          ) + "\n",
        );
      } else if (events.length > 1) {
        const okCount = results.filter((result) => (result.code ?? 1) === 0).length;
        const failedCount = results.length - okCount;
        const line = `[oidc] completed ${results.length} Trusted Publishing Events: ${okCount} ok, ${failedCount} failed.\n`;
        client.log(exitCode === 0 ? "stdout" : "stderr", line);
      }
      client.exit(exitCode, exitCode === 0 ? "OIDC events completed." : "OIDC events failed.");
    };

    return new Map(
      events.map((event) => [
        event.id,
        {
          log: (stream, data) => {
            if (json) logs.push({ eventId: event.id, stream, data });
            else client.log(stream, data);
          },
          exit: (code, message) => {
            if (!exits.has(event.id)) exits.set(event.id, { code, message });
            finishIfDone();
          },
        },
      ]),
    );
  }

  private async resolveOidcTargets(
    req: IpcOidcRequest,
  ): Promise<
    { ok: true; targets: TrustedPublishingTarget[]; root?: string } | { ok: false; error: string }
  > {
    const names = [...new Set(req.packageNames.map((name) => name.trim()).filter(Boolean))];
    const cwd = path.resolve(req.cwd);
    if (req.recursive) {
      const found = await findProjectRoot(cwd, realFs);
      const root = found.root ?? cwd;
      if (isRiskyRoot(root, realFs)) {
        return { ok: false, error: `Refusing to scan risky OIDC root: ${root}` };
      }
      const scanned = await scanWorkspace(root, realFs, { root, respectGitignore: true });
      const selected =
        names.length === 0 ? scanned : scanned.filter((pkg) => names.includes(pkg.name));
      if (selected.length === 0) {
        return { ok: false, error: "No publishable workspace packages matched the OIDC target." };
      }
      return {
        ok: true,
        root,
        targets: selected.map((pkg) => ({
          name: pkg.name,
          path: pkg.path,
          ...(pkg.repository ? { repository: pkg.repository } : {}),
        })),
      };
    }

    if (names.length === 0) {
      const target = await readPublishTarget({ kind: "directory", path: cwd });
      if (!target.name || target.name === "(unknown)") {
        return { ok: false, error: `No package.json package name found at ${cwd}.` };
      }
      return {
        ok: true,
        targets: [
          {
            name: target.name,
            path: cwd,
            ...(target.repository ? { repository: target.repository } : {}),
          },
        ],
      };
    }

    const localTargets = await this.scanOidcNamedTargets(cwd);
    return {
      ok: true,
      targets: names.map((name) => {
        const local = localTargets.get(name);
        return local ?? { name };
      }),
    };
  }

  /** Capture every removal target before creating any Event, so groups are atomic. */
  private async captureRemovalSnapshots(
    profile: string,
    targets: readonly TrustedPublishingTarget[],
  ): Promise<
    { ok: true; snapshots: TrustedPublisherRegistryConfig[][] } | { ok: false; error: string }
  > {
    const creds = this.store.getCredentials(profile);
    if (!creds) {
      return {
        ok: false,
        error: `Credentials for ${profile} are missing. Re-apply them in the tray.`,
      };
    }
    const registry = this.store.getProfile(profile)?.registry ?? "https://registry.npmjs.org/";
    const results = await Promise.all(
      targets.map(async (target) => {
        try {
          const result = await listTrustedPublishers(
            { registry, token: creds.token, totpSecret: creds.totpSecret },
            target.name,
          );
          return result.ok
            ? { ok: true as const, configs: result.configs }
            : { ok: false as const, error: result.error, name: target.name };
        } catch (error: unknown) {
          return { ok: false as const, error: errorToMessage(error), name: target.name };
        }
      }),
    );
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) {
      return {
        ok: false,
        error: `Failed to snapshot trusted publishers for ${failed.name}: ${failed.error}`,
      };
    }
    return {
      ok: true,
      snapshots: results.map((result) => (result.ok ? result.configs : [])),
    };
  }

  private async scanOidcNamedTargets(cwd: string): Promise<Map<string, TrustedPublishingTarget>> {
    try {
      const found = await findProjectRoot(cwd, realFs);
      if (!found.root || isRiskyRoot(found.root, realFs)) return new Map();
      const scanned = await scanWorkspace(found.root, realFs, {
        root: found.root,
        respectGitignore: true,
      });
      return new Map(
        scanned.map((pkg) => [
          pkg.name,
          {
            name: pkg.name,
            path: pkg.path,
            ...(pkg.repository ? { repository: pkg.repository } : {}),
          },
        ]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Best-effort prefetch of a single-package tarball preview. Runs `npm pack
   * --dry-run` (no real tarball) and writes the summary back to the pending
   * event via `store.setTarballSummary`, which re-emits over WS so the WebUI
   * shows the preview live. Failures are swallowed — the publish flow is
   * unaffected, and a missing preview is not fatal.
   */
  private async prefetchPublishSummary(eventId: string, dir: string): Promise<void> {
    try {
      const summary = await previewPackageFiles(dir);
      this.store.setTarballSummary(eventId, summary);
    } catch {
      // Preview is best-effort; ignore.
    }
  }

  /**
   * Best-effort prefetch of per-target tarball previews for a recursive
   * publish. Computes a summary for each target directory and writes the whole
   * batch back atomically via `store.setTarballSummaries`. Targets are packed
   * sequentially to avoid spawning many concurrent `npm` processes; the whole
   * task is non-blocking and any failure leaves the event preview-less but does
   * not affect the publish.
   */
  private async prefetchRecursiveSummaries(
    eventId: string,
    targets: { name: string; version: string; path: string }[],
  ): Promise<void> {
    try {
      const summaries: { name: string; version: string; summary: PackageTarballSummary }[] = [];
      for (const t of targets) {
        try {
          const summary = await previewPackageFiles(t.path);
          summaries.push({ name: t.name, version: t.version, summary });
        } catch {
          // A single target failing should not drop the rest.
        }
      }
      if (summaries.length > 0) this.store.setTarballSummaries(eventId, summaries);
    } catch {
      // Best-effort; ignore.
    }
  }

  /**
   * Enumerate the publishable targets a recursive publish would operate on,
   * via `pnpm list -r`, honoring `--filter` selectors from the args. Private
   * packages are excluded (pnpm publish -r skips them too).
   */
  private async enumerateRecursiveTargets(
    cwd: string,
    args: string[],
    client: PendingClient,
  ): Promise<PublishTarget[]> {
    client.log("stdout", "enumerating workspace packages...\n");
    const all = await listRecursivePackages(cwd);
    // Apply --filter selectors if present; otherwise take all non-private.
    const filters = readRecursiveFilters(args);
    const publicPkgs = all.filter((p) => !p.private);
    let selected = publicPkgs;
    if (filters.length > 0) {
      const root = await resolveRecursivePublishRoot({ kind: "directory", path: cwd });
      const scanned = await scanWorkspace(root, realFs, { root, respectGitignore: true });
      const matched = await applyRecursiveFilters(
        scanned,
        root,
        filters,
        readChangedFilesIgnorePatterns(args),
        cwd,
      );
      const matchedNames = new Set(matched.map((m) => m.name));
      selected = publicPkgs.filter((p) => matchedNames.has(p.name));
    }
    // Resolve full targets (incl. repository, for the corner github-opener).
    const targets: PublishTarget[] = [];
    for (const p of selected) {
      const meta = await readPublishTarget({ kind: "directory", path: p.path });
      targets.push({ ...meta, name: p.name, version: p.version, path: p.path });
    }
    return targets;
  }

  /**
   * GUI-originated actions use the same pending-wall law as CLI publishes:
   * create the Event through the store, then register it in the executable
   * pending map before any confirm action can reach NPM or the filesystem.
   */
  async createProactiveEvent(
    kind: EventKind,
    profile: string,
    payload: unknown,
    groupId?: string,
  ): Promise<ProactiveEventResult> {
    if (!this.store.getProfile(profile)) {
      return { ok: false, error: `Profile "${profile}" not found. Add it via the tray GUI first.` };
    }
    const parsed = parseProactivePayload(kind, payload);
    if (!parsed) {
      return { ok: false, error: `Invalid or unsupported payload for ${kind}.` };
    }
    // For publish events, re-read the target from the source directory so the
    // version/description reflect the CURRENT package.json (not a stale copy
    // carried over from a retry of an older event). The args are kept as-is
    // (they carry the user's advanced-option edits).
    if (parsed.kind === "publish") {
      await this.refreshPublishTarget(parsed);
    } else if (parsed.kind === "recursive-publish") {
      // WebUI button may create the event with empty targets — enumerate them
      // now via `pnpm list -r` so the card shows what will be published.
      await this.refreshRecursiveTargets(parsed);
    }
    const removalSnapshot =
      parsed.kind === "configure-trust" && parsed.data.action === "remove"
        ? await this.captureRemovalSnapshots(profile, [parsed.data.target])
        : null;
    if (removalSnapshot && !removalSnapshot.ok) return removalSnapshot;
    const event = this.store.createEvent({
      kind,
      profile,
      payload: parsed,
      groupId,
      ...(removalSnapshot ? { removalSnapshot: removalSnapshot.snapshots[0] ?? [] } : {}),
    });
    this.pending.set(event.id, { event, client: DETACHED_CLIENT, phase: "awaiting-decision" });
    // Prefetch the tarball preview (best-effort, non-blocking) so the confirm
    // card shows the file tree during the pending phase. Mirrors the CLI
    // `intercept` path so GUI-originated publishes (workspace button, retry)
    // behave identically.
    if (parsed.kind === "publish" && parsed.data.source.kind === "directory") {
      void this.prefetchPublishSummary(event.id, parsed.data.source.path);
    } else if (parsed.kind === "recursive-publish" && parsed.data.targets.length > 0) {
      void this.prefetchRecursiveSummaries(event.id, parsed.data.targets);
    }
    return { ok: true, event };
  }

  /**
   * Re-read package.json from the publish source dir and refresh the payload's
   * target (version/description/repository/…) in place.
   */
  private async refreshPublishTarget(payload: {
    kind: "publish";
    data: PublishContext;
  }): Promise<void> {
    try {
      const target = await readPublishTarget(payload.data.source);
      payload.data.target = {
        ...target,
        path: payload.data.source.path,
        // Preserve repository if readPublishTarget didn't provide one but the
        // original payload had one (e.g. from a git-remote fallback).
        ...(payload.data.target.repository && !target.repository
          ? { repository: payload.data.target.repository }
          : {}),
      };
    } catch {
      // keep the original target if the source is unreadable
    }
  }

  /**
   * Enumerate (or re-enumerate) the workspace targets for a recursive-publish
   * event so the card reflects the current set of publishable packages.
   * Requires pnpm; on failure the original targets are preserved.
   */
  private async refreshRecursiveTargets(payload: {
    kind: "recursive-publish";
    data: RecursivePublishContext;
  }): Promise<void> {
    try {
      if (!(await hasPnpm(payload.data.source.path))) return;
      // Reuse enumerateRecursiveTargets so targets carry repository (for the
      // corner git-opener) and respect --filter selectors consistently.
      payload.data.targets = await this.enumerateRecursiveTargets(
        payload.data.source.path,
        payload.data.args,
        DETACHED_CLIENT,
      );
    } catch {
      // keep the original targets if enumeration fails
    }
  }

  /** Step 2 (Chapter 3.3.3 / 8.3.8): WebUI confirmed. Execute the write. */
  async confirm(taskId: string): Promise<boolean> {
    return this.confirmInternal(taskId, false);
  }

  /**
   * Confirm the pending members of one batch as a single source action.
   * Grouped removals are intentionally stricter: every member has to carry a
   * persisted human decision before any registry DELETE is permitted. A Keep
   * resolves as a user rejection; it is never conflated with the no-op
   * `skipped` status used by config equality preflight.
   */
  async confirmGroup(groupId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const members = this.store.getPendingGroupEvents(groupId);
    if (members.length === 0) return { ok: false, error: "No pending events in this group." };

    const removals = members.filter(
      (event) =>
        event.payload?.kind === "configure-trust" && event.payload.data.action === "remove",
    );
    const removalReviews = removals.map((event) => ({
      event,
      review: removalSnapshotReview(event),
    }));
    if (removalReviews.some(({ review }) => !review.complete)) {
      return {
        ok: false,
        error: "A trusted-publisher removal snapshot or decision set is incomplete.",
      };
    }
    const hasAnyRemove = removalReviews.some(({ review }) => review.hasRemove);
    if (removals.length > 0 && !hasAnyRemove) {
      return {
        ok: false,
        error: "No trusted-publisher configs are marked for removal.",
      };
    }

    // A package whose reviewed configs are all kept has no registry effect.
    // Resolve that explicit choice before executing sibling removals.
    for (const { event, review } of removalReviews) {
      if (review.allKeep) {
        this.reject(event.id, "Trusted publisher configs kept by user.");
      }
    }
    for (const event of members) {
      const current = this.store.getEvent(event.id);
      if (!current || current.status !== "pending") continue;
      await this.confirmInternal(event.id, true);
    }
    return { ok: true };
  }

  /** Executes a confirmed event after the caller has established its authority. */
  private async confirmInternal(taskId: string, allowGroupedRemoval: boolean): Promise<boolean> {
    const entry = this.pending.get(taskId);
    if (!entry) return false;
    const isGroupedRemoval =
      !!entry.event.groupId &&
      entry.event.payload?.kind === "configure-trust" &&
      entry.event.payload.data.action === "remove";
    if (isGroupedRemoval && !allowGroupedRemoval) return false;
    const isStandaloneRemoval =
      !entry.event.groupId &&
      entry.event.payload?.kind === "configure-trust" &&
      entry.event.payload.data.action === "remove";
    if (isStandaloneRemoval) {
      const review = removalSnapshotReview(entry.event);
      if (!review.complete || !review.hasRemove) return false;
    }
    entry.phase = "executing";
    const { event, client } = entry;
    if (event.payload?.kind === "refresh-token") {
      const msg = `Token refresh for ${event.payload.data.username} requires credential re-apply.`;
      this.store.resolveEvent(taskId, "action-required", msg);
      client.log("stdout", msg + "\n");
      client.exit(0);
      this.pending.delete(taskId);
      return true;
    }

    if (event.payload?.kind === "publish") {
      const recursive = isRecursivePublish(event.payload.data.args);
      const dryRun = isDryRunPublish(event.payload.data.args);
      const gitCheckPath = recursive
        ? await resolveRecursivePublishRoot(event.payload.data.source)
        : event.payload.data.source.kind === "directory"
          ? event.payload.data.source.path
          : path.dirname(event.payload.data.source.path);
      const gitCheck = await checkPublishGitState(gitCheckPath, event.payload.data.args);
      if (!gitCheck.ok) {
        this.store.resolveEvent(taskId, "failed", gitCheck.error);
        client.log("stderr", gitCheck.error + "\n");
        client.exit(1, gitCheck.error);
        this.pending.delete(taskId);
        return true;
      }
      if (recursive && dryRun) {
        await this.runRecursivePublishDryRun(event, client);
        this.pending.delete(taskId);
        return true;
      }
    }

    if (event.payload?.kind === "recursive-publish") {
      // Recursive publish: git-check at the workspace root, then run.
      const gitCheckPath = await resolveRecursivePublishRoot(event.payload.data.source);
      const gitCheck = await checkPublishGitState(gitCheckPath, event.payload.data.args);
      if (!gitCheck.ok) {
        this.store.resolveEvent(taskId, "failed", gitCheck.error);
        client.log("stderr", gitCheck.error + "\n");
        client.exit(1, gitCheck.error);
        this.pending.delete(taskId);
        return true;
      }
    }

    if (event.payload?.kind === "publish" && isDryRunPublish(event.payload.data.args)) {
      await this.runPublishDryRun(event, client);
      this.pending.delete(taskId);
      return true;
    }

    const creds = this.store.getCredentials(event.profile);
    if (!creds) {
      const msg = `Credentials for ${event.profile} are missing. Re-apply them in the tray.`;
      this.store.resolveEvent(taskId, "action-required", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
      this.pending.delete(taskId);
      return true;
    }

    const profile = this.store.getProfile(event.profile);
    const profileRegistry = profile?.registry ?? "https://registry.npmjs.org/";

    // Resolve the publish payload.
    if (event.payload?.kind === "publish") {
      const packagePublishConfig = event.payload.data.target.publishConfig;
      const registry = resolvePublishRegistry(
        event.payload.data.args,
        packagePublishConfig?.registry ?? profileRegistry,
      );
      const distTag = resolvePublishDistTag(event.payload.data.args, packagePublishConfig?.tag);
      const access = resolvePublishAccess(event.payload.data.args, packagePublishConfig?.access);
      const otp = resolvePublishOtp(event.payload.data.args);
      const reportSummary = isReportSummaryPublish(event.payload.data.args);
      const ignoreScripts = isIgnoreScriptsPublish(event.payload.data.args);
      const json = isJsonPublish(event.payload.data.args);
      await this.runPublish(
        event,
        client,
        creds.token,
        creds.totpSecret,
        registry,
        distTag,
        access,
        otp,
        reportSummary,
        ignoreScripts,
        json,
      );
    } else if (event.payload?.kind === "configure-trust") {
      await this.runConfigureTrust(event, client, creds.token, creds.totpSecret, profileRegistry);
    } else if (event.payload?.kind === "create-placeholder") {
      await this.runPlaceholder(event, client, creds.token, creds.totpSecret, profileRegistry);
    } else if (event.payload?.kind === "unpublish") {
      await this.runUnpublish(event, client, creds.token, creds.totpSecret, profileRegistry);
    } else if (event.payload?.kind === "recursive-publish") {
      const registry = resolvePublishRegistry(event.payload.data.args, profileRegistry);
      const otp = resolvePublishOtp(event.payload.data.args);
      const json = isJsonPublish(event.payload.data.args);
      await this.runRecursivePublish(
        event,
        client,
        creds.token,
        creds.totpSecret,
        registry,
        otp,
        json,
      );
    }
    this.pending.delete(taskId);
    return true;
  }

  /** Step 2-alt: WebUI rejected. Relay SIGINT-equivalent to the CLI (Chapter 6.2.2). */
  reject(taskId: string, message?: string): boolean {
    const entry = this.pending.get(taskId);
    if (!entry || entry.phase !== "awaiting-decision") return false;
    const { client } = entry;
    const keptRemoval =
      entry.event.payload?.kind === "configure-trust" &&
      entry.event.payload.data.action === "remove" &&
      removalSnapshotReview(entry.event).allKeep;
    const rejectionMessage =
      message ??
      (keptRemoval
        ? "Trusted publisher configs kept by user."
        : entry.event.payload?.kind === "configure-trust"
          ? "Trusted Publishing Event rejected by user."
          : "Publish canceled by user.");
    this.store.resolveEvent(taskId, "rejected", rejectionMessage);
    client.log("stderr", rejectionMessage + "\n");
    client.exit(1, rejectionMessage);
    this.pending.delete(taskId);
    return true;
  }

  /** Non-WebUI owner disappeared before confirmation. Does not rewrite live writes. */
  cancel(
    taskId: string,
    reason = "Publish canceled because the CLI client disconnected.",
  ): boolean {
    const entry = this.pending.get(taskId);
    if (!entry || entry.phase !== "awaiting-decision") return false;
    this.store.resolveEvent(taskId, "canceled", reason);
    this.pending.delete(taskId);
    return true;
  }

  /**
   * Route a publish outcome (CLI or API) to the event store + CLI exit. Shared
   * by single-package and recursive publish so the ok/expired/failed branching
   * stays in one place (Chapter 6.2.4 expired-token handling included).
   */
  private resolvePublishOutcome(
    event: PubEvent,
    client: PendingClient,
    result: PublishResultLike,
    opts: { successMessage?: string; extra?: Record<string, unknown> } = {},
  ): void {
    if (result.ok) {
      const message = opts.successMessage ?? result.stdout;
      this.store.resolveEvent(event.id, "success", message, {
        clockDriftRecovered: result.clockDriftRecovered,
        ...opts.extra,
      });
      client.exit(0);
    } else if (result.expired) {
      const msg = `Token for ${event.profile} is expired or revoked. Renew it in the tray.`;
      this.store.resolveEvent(event.id, "expired", msg, opts.extra);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    } else {
      // Persist the FULL subprocess log (result.stderr carries the complete
      // pnpm/npm output) so the WebUI's expandable log shows every line —
      // which package failed, the registry error body, etc. Fall back to the
      // single-line extracted error only when no stderr was captured.
      const fullLog = result.stderr?.trim() || result.error;
      this.store.resolveEvent(event.id, "failed", fullLog, opts.extra);
      client.exit(1, result.error);
    }
  }

  private async runPublish(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
    distTag: string | undefined,
    access: string | undefined,
    otp: string | undefined,
    reportSummary: boolean,
    ignoreScripts: boolean,
    json: boolean,
  ): Promise<void> {
    if (event.payload?.kind !== "publish") return;
    const ctx = event.payload.data;
    const name = ctx.target.name;
    const version = ctx.target.version;
    const source = ctx.source;
    try {
      // Preview pack: build the tarball once for the WebUI file-tree preview and
      // the `--json` projection. This is best-effort — a failure here must NOT
      // block the real publish (the CLI path's `pnpm publish` packs again
      // internally; the API path reuses this tarball but can also repack).
      let packed: { tarball: Buffer; metadata: Record<string, unknown> } | undefined;
      try {
        if (!json) {
          client.log(
            "stdout",
            `${source.kind === "directory" ? "packing" : "reading tarball"} ${name}...\n`,
          );
        }
        packed = await loadPublishSource(source, { ignoreScripts });
        if (!json) client.log("stdout", `packed ${packed.tarball.length} bytes\n`);
      } catch (previewError) {
        // Only fatal for the API fallback path (which needs the tarball). The
        // CLI path will attempt its own pack via `pnpm publish`.
        if (source.kind === "tarball") throw previewError;
      }
      const tarballSummary = packed
        ? await summarizePackageTarball(packed.tarball).catch(() => undefined)
        : undefined;
      const publishedName = (packed && readMetadataString(packed.metadata, "name")) ?? name;
      const publishedVersion =
        (packed && readMetadataString(packed.metadata, "version")) ?? version;

      // Assemble the argv forwarded to `pnpm publish`: the user's original args
      // (whitelist-validated) carry --access/--tag/--no-git-checks/etc. The
      // publisher injects --otp (from the TOTP secret) and the registry (via a
      // temporary .npmrc) itself, stripping any stale --otp/--registry the args
      // may carry.

      // Primary path: the real `pnpm publish` child process (Chapter 1.3.1).
      // Falls back to the registry-API path ONLY when pnpm is absent from PATH
      // (and only for directory sources — tarball sources always use the API).
      let result: PublishResultLike | undefined;
      if (source.kind === "directory") {
        try {
          if (!json)
            client.log("stdout", `publishing ${publishedName}@${publishedVersion} via pnpm...\n`);
          result = await publishPackageViaCli({
            cwd: source.path,
            args: ctx.args,
            registry,
            token,
            totpSecret,
            ...(otp ? { otp } : {}),
            sink: { log: (stream, data) => client.log(stream, data) },
          });
        } catch (error: unknown) {
          if (error instanceof PnpmNotOnPathError) {
            if (!json)
              client.log(
                "stderr",
                "pnpm not found on PATH; falling back to registry API publish.\n",
              );
          } else {
            throw error;
          }
        }
      }
      // Fallback / tarball-source path: the registry API (`safe-npm-sdk`).
      if (!result) {
        if (!packed) packed = await loadPublishSource(source, { ignoreScripts });
        const fallbackResult = await publishPackage({
          registry,
          token,
          totpSecret,
          name: publishedName,
          version: publishedVersion,
          tarball: packed.tarball,
          metadata: packed.metadata,
          ...(distTag ? { distTag } : {}),
          ...(access ? { access } : {}),
          ...(otp ? { otp } : {}),
        });
        if (fallbackResult.stdout && !json) client.log("stdout", fallbackResult.stdout + "\n");
        if (fallbackResult.stderr) client.log("stderr", fallbackResult.stderr + "\n");
        result = fallbackResult;
      }
      const publishResult: PublishResultLike = result;

      if (publishResult.ok) {
        if (reportSummary) {
          await writePublishSummary(source, publishedName, publishedVersion);
        }
        const successOutput =
          json && packed
            ? await formatPublishJson(
                publishedName,
                publishedVersion,
                packed.tarball,
                tarballSummary ?? null,
              )
            : publishResult.stdout;
        if (json && packed) client.log("stdout", successOutput);
        this.store.resolveEvent(
          event.id,
          "success",
          publishResult.stdout || `+ ${publishedName}@${publishedVersion}`,
          {
            clockDriftRecovered: publishResult.clockDriftRecovered,
            ...(tarballSummary ? { tarballSummary } : {}),
          },
        );
        client.exit(0);
      } else if (publishResult.expired) {
        // Chapter 6.2.4: token expired/revoked → special Expired event so the
        // UI can prompt for renewal instead of showing a generic failure.
        const msg = `Token for ${event.profile} is expired or revoked. Renew it in the tray.`;
        this.store.resolveEvent(
          event.id,
          "expired",
          msg,
          tarballSummary ? { tarballSummary } : undefined,
        );
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
      } else {
        // Persist the FULL subprocess log so the WebUI's expandable log shows
        // every line; fall back to the single-line error only when empty.
        const fullLog = publishResult.stderr?.trim() || publishResult.error;
        this.store.resolveEvent(
          event.id,
          "failed",
          fullLog,
          tarballSummary ? { tarballSummary } : undefined,
        );
        client.exit(1, publishResult.error);
      }
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  private async runRecursivePublish(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
    otp: string | undefined,
    json: boolean,
  ): Promise<void> {
    if (event.payload?.kind !== "recursive-publish") return;
    const ctx = event.payload.data;
    const source = ctx.source;
    try {
      if (!json) {
        client.log(
          "stdout",
          `recursively publishing ${ctx.targets.length} package${ctx.targets.length === 1 ? "" : "s"} via pnpm...\n`,
        );
      }
      const result = await publishRecursiveViaCli({
        cwd: source.path,
        args: ctx.args,
        registry,
        token,
        totpSecret,
        ...(otp ? { otp } : {}),
        sink: { log: (stream, data) => client.log(stream, data) },
      });
      this.resolvePublishOutcome(event, client, result, {
        successMessage: `+ recursively published ${ctx.targets.length} package${ctx.targets.length === 1 ? "" : "s"}`,
      });
    } catch (error: unknown) {
      if (error instanceof PnpmNotOnPathError) {
        this.resolvePublishOutcome(event, client, {
          ok: false,
          status: 1,
          error: "Recursive publish requires pnpm on PATH; no fallback is available.",
          stdout: "",
          stderr: "",
        });
        return;
      }
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  private async runPublishDryRun(event: PubEvent, client: PendingClient): Promise<void> {
    if (event.payload?.kind !== "publish") return;
    const ctx = event.payload.data;
    const name = ctx.target.name;
    const source = ctx.source;
    const json = isJsonPublish(ctx.args);
    const configWarnings = formatNativeUnknownCliConfigWarnings(ctx.args);
    try {
      const packed = await loadPublishSource(source, {
        ignoreScripts: isIgnoreScriptsPublish(ctx.args),
      });
      const msg = "Dry run complete; no registry write performed.";
      const publishedName = readMetadataString(packed.metadata, "name") ?? name;
      const publishedVersion = readMetadataString(packed.metadata, "version") ?? ctx.target.version;
      // Cache the packed file-tree preview for the WebUI.
      const tarballSummary = await summarizePackageTarball(packed.tarball).catch(() => undefined);
      const profileRegistry =
        this.store.getProfile(event.profile)?.registry ?? "https://registry.npmjs.org/";
      const noticeTarget = {
        registry: resolvePublishRegistry(
          ctx.args,
          ctx.target.publishConfig?.registry ?? profileRegistry,
        ),
        distTag: resolvePublishDistTag(ctx.args, ctx.target.publishConfig?.tag),
        access: resolvePublishAccess(ctx.args, ctx.target.publishConfig?.access),
      };
      if (json) {
        client.log(
          "stdout",
          await formatPublishJson(
            publishedName,
            publishedVersion,
            packed.tarball,
            tarballSummary ?? null,
          ),
        );
        client.log("stderr", configWarnings + formatDryRunPublishDestinationNotice(noticeTarget));
      } else {
        const notice = await formatDryRunNpmNotice({
          name: publishedName,
          version: publishedVersion,
          tarball: packed.tarball,
          summary: tarballSummary ?? null,
          ...noticeTarget,
        });
        if (notice || configWarnings) client.log("stderr", configWarnings + notice);
        client.log("stdout", `+ ${publishedName}@${publishedVersion}\n`);
      }
      this.store.resolveEvent(
        event.id,
        "success",
        msg,
        tarballSummary ? { tarballSummary } : undefined,
      );
      client.exit(0);
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  private async runRecursivePublishDryRun(event: PubEvent, client: PendingClient): Promise<void> {
    if (event.payload?.kind !== "publish") return;
    const ctx = event.payload.data;
    const ignoreScripts = isIgnoreScriptsPublish(ctx.args);
    const filters = readRecursiveFilters(ctx.args);
    const changedFilesIgnorePatterns = readChangedFilesIgnorePatterns(ctx.args);
    const failIfNoMatch = isFailIfNoMatchPublish(ctx.args);
    try {
      const profileRegistry =
        this.store.getProfile(event.profile)?.registry ?? "https://registry.npmjs.org/";
      const root = await resolveRecursivePublishRoot(ctx.source);
      const packages = await scanWorkspace(root, realFs, { root, respectGitignore: true });
      const currentPath =
        ctx.source.kind === "directory" ? ctx.source.path : path.dirname(ctx.source.path);
      const selected = await applyRecursiveFilters(
        packages,
        root,
        filters,
        changedFilesIgnorePatterns,
        currentPath,
      );
      if (selected.length === 0) {
        const msg = `No projects matched the filters in "${root}"`;
        this.store.resolveEvent(event.id, failIfNoMatch ? "failed" : "success", msg);
        client.log("stdout", msg + "\n");
        if (failIfNoMatch) {
          client.exit(1, msg);
        } else {
          client.exit(0);
        }
        return;
      }

      const publishedPackages: PublishedPackageSummary[] = [];
      for (const pkg of selected) {
        const packed = await loadPublishSource(
          { kind: "directory", path: pkg.path },
          { ignoreScripts },
        );
        const publishedName = readMetadataString(packed.metadata, "name") ?? pkg.name;
        const publishedVersion = readMetadataString(packed.metadata, "version") ?? pkg.version;
        publishedPackages.push({ name: publishedName, version: publishedVersion });
        const notice = await formatDryRunNpmNotice({
          name: publishedName,
          version: publishedVersion,
          tarball: packed.tarball,
          registry: resolvePublishRegistry(
            ctx.args,
            pkg.publishConfig?.registry ?? profileRegistry,
          ),
          distTag: resolvePublishDistTag(ctx.args, pkg.publishConfig?.tag),
          access: resolvePublishAccess(ctx.args, pkg.publishConfig?.access),
        });
        if (notice) client.log("stderr", notice);
        client.log("stdout", `+ ${publishedName}@${publishedVersion}\n`);
      }

      if (isReportSummaryPublish(ctx.args)) {
        await writePublishSummaryFile(root, publishedPackages);
      }
      const msg = `Recursive dry run complete; ${selected.length} package${selected.length === 1 ? "" : "s"} packed; no registry write performed.`;
      this.store.resolveEvent(event.id, "success", msg);
      client.exit(0);
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log(error instanceof RecursiveSelectorError ? "stdout" : "stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  private async runPlaceholder(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<void> {
    if (event.payload?.kind !== "create-placeholder") return;
    const ctx = event.payload.data;
    const version = "0.0.0";
    let tempDir: string | null = null;
    try {
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-pub-placeholder-"));
      await fsp.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: ctx.name,
            version,
            description: "Generated placeholder package reserved by pnpm-pub.",
            main: "index.js",
            files: ["index.js"],
          },
          null,
          2,
        ),
        "utf8",
      );
      await fsp.writeFile(path.join(tempDir, "index.js"), "module.exports = {};\n", "utf8");

      client.log("stdout", `packing placeholder ${ctx.name}@${version}...\n`);
      const packed = await packPackage(tempDir);
      client.log("stdout", `packed ${packed.tarball.length} bytes\n`);

      const result = await publishPackage({
        registry,
        token,
        totpSecret,
        name: ctx.name,
        version,
        tarball: packed.tarball,
        metadata: packed.metadata,
      });
      if (result.stdout) client.log("stdout", result.stdout + "\n");
      if (result.stderr) client.log("stderr", result.stderr + "\n");
      if (result.ok) {
        this.store.resolveEvent(event.id, "success", result.stdout, {
          clockDriftRecovered: result.clockDriftRecovered,
        });
        client.exit(0);
      } else if (result.expired) {
        const msg = `Token for ${event.profile} is expired or revoked. Renew it in the tray.`;
        this.store.resolveEvent(event.id, "expired", msg);
        client.log("stderr", msg + "\n");
        client.exit(1, msg);
      } else {
        this.store.resolveEvent(event.id, "failed", result.error);
        client.exit(1, result.error);
      }
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    } finally {
      if (tempDir) {
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  private async runUnpublish(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<void> {
    if (event.payload?.kind !== "unpublish") return;
    const ctx = event.payload.data;
    client.log("stdout", `unpublishing ${ctx.name}@${ctx.version}...\n`);
    try {
      const result = await unpublishVersion({
        registry,
        token,
        totpSecret,
        name: ctx.name,
        version: ctx.version,
      });
      if (result.ok) {
        const msg = result.wholePackageRemoved
          ? `Removed ${ctx.name} entirely (last version).`
          : `Removed ${ctx.name}@${ctx.version}.`;
        this.store.resolveEvent(event.id, "success", msg);
        client.log("stdout", msg + "\n");
        client.exit(0);
      } else {
        this.store.resolveEvent(event.id, "failed", result.error);
        client.log("stderr", result.error + "\n");
        client.exit(1, result.error);
      }
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  private async applyConfigureTrust(
    ctx: ConfigureTrustContext,
    removalSnapshot: readonly TrustedPublisherRegistryConfig[],
    removalDecisions: RemovalDecisions,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<
    | { kind: "ok"; message: string; mutated: boolean }
    | { kind: "fail"; message: string; mutated: boolean }
    | { kind: "skipped"; message: string }
  > {
    if (ctx.action === "remove") {
      const selected = removalSnapshot.filter((config) => removalDecisions[config.id] === "remove");
      const kept = removalSnapshot.filter(
        (config) => removalDecisions[config.id] === "keep",
      ).length;
      const unreviewed = removalSnapshot.length - selected.length - kept;
      if (selected.length === 0)
        return {
          kind: "skipped",
          message: `[configure-trust] no selected trusted publisher config remains for ${ctx.target.name}; skipped.`,
        };
      let removed = 0;
      for (const config of selected) {
        const result = await removeTrustedPublisher(
          { registry, token, totpSecret },
          ctx.target.name,
          config.id,
        );
        if (!result.ok) {
          return {
            kind: "fail",
            message:
              `${result.error ?? `Failed to remove trusted publisher config ${config.id} for ${ctx.target.name}.`}` +
              (removed > 0 ? ` ${removed} config(s) were already removed.` : ""),
            mutated: removed > 0,
          };
        }
        removed++;
      }
      const unchanged = [
        kept > 0 ? `kept ${kept}` : "",
        unreviewed > 0 ? `left ${unreviewed} unreviewed unchanged` : "",
      ].filter(Boolean);
      return {
        kind: "ok",
        message: `[configure-trust] removed ${removed} trusted publisher config${removed === 1 ? "" : "s"} from ${ctx.target.name}${unchanged.length > 0 ? `; ${unchanged.join("; ")}` : ""}.`,
        mutated: true,
      };
    }

    if (!ctx.config) {
      return {
        kind: "fail",
        message: "Trusted publisher config is required before confirmation.",
        mutated: false,
      };
    }

    // ---- Pre-flight: fetch the registry's current trusted publisher configs.
    // npm's POST returns 409 ("already exists") whenever ANY config is present,
    // regardless of add vs update. So we resolve the three cases ourselves:
    //   - EQUAL    : a current config matches the desired one ⇒ SKIP (no HTTP).
    //   - CONFLICT : a current config DIFFERS ⇒ DELETE the old one first, then
    //                POST the new one (delete-then-put), avoiding the 409.
    //   - ADD      : no current config ⇒ POST directly.
    // `listTrustLookup` is best-effort; on lookup failure we fall through to a
    // direct POST (preferring to surface a real registry error over a silent
    // no-op).
    const lookup = await listTrustLookup({ registry, token, totpSecret }, ctx.target.name);
    if (lookup.ok) {
      // Skip if any current config already equals the desired one.
      if (lookup.configs.some((c) => trustedPublisherConfigsEqual(ctx.config!, c))) {
        return {
          kind: "skipped",
          message: `[configure-trust] ${ctx.target.name} already matches the desired config; skipped.`,
        };
      }
      // Conflict: delete every existing config first, then POST. This is the
      // authoritative delete-then-put that npm's "Please delete and re-create"
      // 409 message asks for. We delete ALL current configs (a package may in
      // principle carry more than one) so the POST lands cleanly.
      for (const existing of lookup.configs) {
        if (!existing.id) continue;
        const removed = await removeTrustedPublisher(
          { registry, token, totpSecret },
          ctx.target.name,
          existing.id,
        );
        if (!removed.ok) {
          return {
            kind: "fail",
            message:
              removed.error ??
              `Failed to remove the existing trusted publisher for ${ctx.target.name} before applying the new one.`,
            mutated: true,
          };
        }
      }
    }

    // POST the desired config (clean add after the deletes above, or a fresh
    // add when there was nothing to remove).
    const added = await addTrustedPublisher(
      { registry, token, totpSecret },
      ctx.target.name,
      ctx.config,
    );
    if (!added.ok) {
      return {
        kind: "fail",
        message: added.error ?? `Failed to configure trusted publisher for ${ctx.target.name}.`,
        mutated: false,
      };
    }
    return {
      kind: "ok",
      message: `[configure-trust] configured ${ctx.target.name}`,
      mutated: true,
    };
  }

  private async runConfigureTrust(
    event: PubEvent,
    client: PendingClient,
    token: string,
    totpSecret: string,
    registry: string,
  ): Promise<void> {
    if (event.payload?.kind !== "configure-trust") return;
    // Resolve the effective config: inherit members get the group default,
    // custom members get their own. Falls back to the raw payload data when no
    // resolution applies (standalone events, remove actions).
    const ctx = this.store.resolveConfigureTrustConfig(event);
    client.log("stdout", `configuring trusted publishing for ${ctx.target.name}...\n`);
    try {
      const result = await this.applyConfigureTrust(
        ctx,
        event.removalSnapshot ?? [],
        event.removalDecisions ?? {},
        token,
        totpSecret,
        registry,
      );
      if (result.kind === "ok" || result.kind === "fail") {
        if (result.mutated) this.store.invalidateTrustedPublishing([ctx.target.name]);
      }
      if (result.kind === "ok") {
        this.store.resolveEvent(event.id, "success", result.message);
        client.log("stdout", result.message + "\n");
        client.exit(0);
      } else if (result.kind === "skipped") {
        // No HTTP write happened — the registry's current config already equals
        // the desired one. Resolve as a distinct neutral status.
        this.store.resolveEvent(event.id, "skipped", result.message);
        client.log("stdout", result.message + "\n");
        client.exit(0);
      } else {
        this.store.resolveEvent(event.id, "failed", result.message);
        client.log("stderr", result.message + "\n");
        client.exit(1, result.message);
      }
    } catch (error: unknown) {
      const msg = errorToMessage(error);
      this.store.resolveEvent(event.id, "failed", msg);
      client.log("stderr", msg + "\n");
      client.exit(1, msg);
    }
  }

  /** Reject every still-pending event (daemon shutdown). */
  drainAll(): void {
    for (const id of this.pending.keys()) {
      this.reject(id);
    }
  }
}
