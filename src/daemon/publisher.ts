/**
 * `pnpm publish` subprocess executor (the project's raison d'être).
 *
 * This is the PRIMARY publish path: the real `pnpm publish` command is invoked
 * as a child process so pnpm itself owns workspace version substitution,
 * lifecycle scripts, and manifest normalization — a true 1:1 replacement of
 * `pnpm publish` (Chapter 1.3.1). The legacy registry-API path
 * (`npm-api.ts:publishPackage`) remains as a FALLBACK only when pnpm is absent
 * from PATH (Chapter 7.1.2).
 *
 * This module is a thin façade over two focused collaborators:
 *   - `npmrc-auth.ts` — inherited external userconfig auth injection
 *   - `subprocess-runner.ts` — streaming spawn, OTP, clock-drift recovery
 *
 * It owns the two concerns that are *not* subprocess mechanics: pnpm presence
 * probing and workspace package enumeration.
 */
import { execa } from "execa";
import {
  runPublishWithDriftRecovery,
  ensureRecursive,
  type CliPublishResult,
  type PublishLogSink,
} from "./subprocess-runner.js";

// Re-export the types + pure helpers the scheduler / tests depend on, so the
// public surface is stable regardless of the internal module layout.
export type { CliPublishResult, PublishLogSink } from "./subprocess-runner.js";
export { stripOverriddenArgs, ensureRecursive, extractNpmError } from "./subprocess-runner.js";
export { registryAuthPrefix, mergeAuthIntoNpmrc } from "./npmrc-auth.js";

/** Raised when `pnpm` cannot be found on PATH; the scheduler falls back to the
 *  registry-API publish path (single-package only; recursive is unsupported). */
export class PnpmNotOnPathError extends Error {
  constructor(message = "pnpm is not available on PATH.") {
    super(message);
    this.name = "PnpmNotOnPathError";
  }
}

/** Whether `pnpm` is resolvable on PATH (probe via `--version`). */
export async function hasPnpm(cwd: string): Promise<boolean> {
  const probe = await execa("pnpm", ["--version"], { cwd, reject: false });
  return probe.exitCode === 0;
}

/** A package enumerated from a pnpm workspace (`pnpm list -r --depth -1`). */
export interface RecursivePackage {
  name: string;
  version: string;
  /** Absolute directory of the package. */
  path: string;
  /** Whether the package is private (excluded from real publishes). */
  private: boolean;
}

/**
 * Enumerate the packages in a pnpm workspace via `pnpm list -r --json --depth -1`.
 *
 * Used to populate a recursive-publish event's targets so the WebUI can show
 * what will be published before confirmation. Mirrors what `pnpm publish -r`
 * would operate on (minus `--filter` selectors, which the scheduler applies
 * separately). Throws {@link PnpmNotOnPathError} when pnpm is absent.
 */
export async function listRecursivePackages(cwd: string): Promise<RecursivePackage[]> {
  if (!(await hasPnpm(cwd))) throw new PnpmNotOnPathError();
  const result = await execa("pnpm", ["list", "-r", "--json", "--depth", "-1"], {
    cwd,
    reject: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `pnpm list -r failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }
  const parsed: unknown = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(parsed)) return [];
  return parseRecursivePackageList(parsed);
}

/** Parse the `pnpm list -r --json` payload into typed packages, tolerating
 *  malformed entries (skipped) rather than throwing. Exported for testing. */
export function parseRecursivePackageList(entries: unknown[]): RecursivePackage[] {
  const packages: RecursivePackage[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== "string" || typeof e.version !== "string" || typeof e.path !== "string")
      continue;
    packages.push({ name: e.name, version: e.version, path: e.path, private: e.private === true });
  }
  return packages;
}

export interface PublishViaCliOpts {
  cwd: string;
  /** User's original publish argv (whitelist-validated by the scheduler). */
  args: string[];
  registry: string;
  token: string;
  totpSecret: string;
  /** One-shot OTP supplied via CLI `--otp` (overrides the TOTP secret). */
  otp?: string;
  sink: PublishLogSink;
}

/**
 * Publish a single package via `pnpm publish`.
 *
 * Throws {@link PnpmNotOnPathError} when pnpm is not on PATH (scheduler falls
 * back to the registry-API path). The OTP is derived from the secret and
 * clock-drift self-healing retries once on an OTP failure.
 */
export async function publishPackageViaCli(opts: PublishViaCliOpts): Promise<CliPublishResult> {
  if (!(await hasPnpm(opts.cwd))) throw new PnpmNotOnPathError();
  return runPublishWithDriftRecovery(opts);
}

/**
 * Publish recursively via `pnpm publish -r` (workspace).
 *
 * Recursive publish REQUIRES pnpm — there is no API fallback. The scheduler
 * must guarantee pnpm availability; this function still throws
 * {@link PnpmNotOnPathError} defensively so the caller can surface a clear error.
 */
export async function publishRecursiveViaCli(opts: PublishViaCliOpts): Promise<CliPublishResult> {
  if (!(await hasPnpm(opts.cwd))) throw new PnpmNotOnPathError();
  return runPublishWithDriftRecovery({ ...opts, args: ensureRecursive(opts.args) });
}
