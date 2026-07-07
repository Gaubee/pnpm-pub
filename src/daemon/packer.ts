/**
 * Tarball packer — builds the publishable `.tgz` for a package directory.
 *
 * Prefers `pnpm pack` (this tool's namesake) and falls back to `npm pack`,
 * matching the spec's promise of 1:1 compatibility with `pnpm publish`
 * (Chapter 1.3.1 / 7.1.2). The produced tarball is returned as bytes so the
 * NPM API layer can attach it to the publish request.
 */
import { spawn, execFile as execFileCb } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const execFile = promisify(execFileCb);

export interface PackResult {
  /** Raw tarball bytes. */
  tarball: Buffer;
  /** The package.json metadata that was packed. */
  metadata: Record<string, unknown>;
}

export interface PackageTarballFile {
  path: string;
  size: number;
  mode: number;
}

export interface PackageTarballSummary {
  /** Own package files shown in npm notice Tarball Contents. */
  files: PackageTarballFile[];
  /** Unpacked size across own files and bundled dependency files. */
  unpackedSize: number;
  /** Total file entries in the tarball, including bundled dependency files. */
  entryCount: number;
  bundled: string[];
}

export interface PackOptions {
  /** Forward native publish/pack intent to skip lifecycle scripts. */
  ignoreScripts?: boolean;
}

function parsePackageMetadata(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonObject(parsed)) {
    throw new Error("Invalid package.json metadata.");
  }
  return parsed;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTarString(block: Buffer, start: number, length: number): string {
  const raw = block.subarray(start, start + length);
  const nul = raw.indexOf(0);
  return raw.subarray(0, nul >= 0 ? nul : raw.length).toString("utf8");
}

function readTarSize(block: Buffer): number {
  const text = readTarString(block, 124, 12).trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readTarMode(block: Buffer): number {
  const text = readTarString(block, 100, 8).trim();
  if (!text) return 0;
  const parsed = Number.parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tarEntryName(block: Buffer): string {
  const name = readTarString(block, 0, 100);
  const prefix = readTarString(block, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function walkTarEntries(
  tarball: Buffer,
  visit: (entry: {
    header: Buffer;
    name: string;
    size: number;
    bodyStart: number;
    bodyEnd: number;
  }) => void,
): void {
  let offset = 0;
  while (offset + 512 <= tarball.length) {
    const header = tarball.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarEntryName(header);
    const size = readTarSize(header);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tarball.length) break;
    visit({ header, name, size, bodyStart, bodyEnd });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
}

function extractPackageJsonFromTar(tarball: Buffer): string {
  let packageJson: string | null = null;
  walkTarEntries(tarball, ({ name, bodyStart, bodyEnd }) => {
    if (name === "package/package.json" || name.endsWith("/package.json")) {
      packageJson = tarball.subarray(bodyStart, bodyEnd).toString("utf8");
    }
  });
  if (packageJson) {
    return packageJson;
  }
  throw new Error("Tarball does not contain package.json metadata.");
}

function normalizePackageTarPath(name: string): string {
  return name.startsWith("package/") ? name.slice("package/".length) : name;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readDependencyObjectNames(value: unknown): string[] {
  if (!isJsonObject(value)) return [];
  return Object.keys(value);
}

function readBundledDependencyNames(metadata: Record<string, unknown>): string[] {
  const explicit = [
    ...readStringArray(metadata.bundleDependencies),
    ...readStringArray(metadata.bundledDependencies),
  ];
  if (explicit.length > 0) return [...new Set(explicit)];
  if (metadata.bundleDependencies === true || metadata.bundledDependencies === true) {
    return readDependencyObjectNames(metadata.dependencies);
  }
  return [];
}

function readNodeModulesPackageName(file: string): string | undefined {
  const prefix = "node_modules/";
  if (!file.startsWith(prefix)) return undefined;
  const parts = file.slice(prefix.length).split("/");
  const first = parts[0];
  if (!first) return undefined;
  if (first.startsWith("@")) {
    const second = parts[1];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

function summarizeTar(tarball: Buffer): PackageTarballSummary {
  const metadata = parsePackageMetadata(extractPackageJsonFromTar(tarball));
  const bundled = readBundledDependencyNames(metadata);
  const bundledSet = new Set(bundled);
  const files: PackageTarballFile[] = [];
  let unpackedSize = 0;
  let entryCount = 0;
  walkTarEntries(tarball, ({ header, name, size }) => {
    const type = readTarString(header, 156, 1);
    if (type && type !== "0") return;
    const normalized = normalizePackageTarPath(name);
    if (!normalized) return;
    unpackedSize += size;
    entryCount += 1;
    const bundledPackageName = readNodeModulesPackageName(normalized);
    if (bundledPackageName && bundledSet.has(bundledPackageName)) return;
    files.push({
      path: normalized,
      size,
      mode: readTarMode(header),
    });
  });
  return {
    files,
    unpackedSize,
    entryCount,
    bundled,
  };
}

/** Normalize child-process output chunks before adding them to captured output. */
export function normalizeOutputChunk(chunk: unknown): Buffer | null {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk, "utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return null;
}

function pushOutputChunk(chunks: Buffer[], chunk: unknown): void {
  const normalized = normalizeOutputChunk(chunk);
  if (normalized) chunks.push(normalized);
}

/** Run a command, capturing stdout/stderr text. */
function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: unknown) => pushOutputChunk(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: unknown) => pushOutputChunk(stderrChunks, chunk));
    child.on("error", () => resolve({ code: 1, stdout: "", stderr: "spawn failed" }));
    child.on("close", (code) =>
      resolve({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      }),
    );
  });
}

/** Whether a given binary is resolvable on PATH. */
async function has(cmd: string, cwd: string): Promise<boolean> {
  const probe = await run(cmd, ["--version"], cwd);
  return probe.code === 0;
}

/** Locate the newest `.tgz` in `dir` after packing. */
async function newestTgz(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return null;
  }
  let newest: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(".tgz")) continue;
    const full = path.join(dir, entry);
    try {
      const st = await fsp.stat(full);
      if (!newest || st.mtimeMs > newest.mtime) newest = { path: full, mtime: st.mtimeMs };
    } catch {
      /* ignore */
    }
  }
  return newest?.path ?? null;
}

/**
 * Pack `cwd` into a tarball. Prefers `pnpm pack`, falls back to `npm pack`.
 * Writes the new tarball into a daemon-owned temp directory so package-local
 * `.tgz` files remain user artifacts, not scratch state.
 */
export async function packPackage(cwd: string, opts: PackOptions = {}): Promise<PackResult> {
  // Read metadata BEFORE packing so we can name/validate the result.
  const pkgJsonPath = path.join(cwd, "package.json");
  const metadata = parsePackageMetadata(await fsp.readFile(pkgJsonPath, "utf8"));

  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pnpm-pub-pack-"));
  try {
    let res: { code: number; stdout: string; stderr: string };
    if (opts.ignoreScripts) {
      if (await has("npm", cwd)) {
        res = await run("npm", ["pack", "--pack-destination", outputDir, "--ignore-scripts"], cwd);
      } else {
        throw new Error("npm is required on PATH to pack with --ignore-scripts.");
      }
    } else if (await has("pnpm", cwd)) {
      res = await run("pnpm", ["pack", "--pack-destination", outputDir], cwd);
    } else if (await has("npm", cwd)) {
      res = await run("npm", ["pack", "--pack-destination", outputDir], cwd);
    } else {
      throw new Error("Neither pnpm nor npm is available on PATH; cannot pack.");
    }
    if (res.code !== 0) {
      throw new Error(`pack failed (exit ${res.code}): ${res.stderr || res.stdout}`);
    }

    const packedTarballFile = await newestTgz(outputDir);
    if (!packedTarballFile) {
      throw new Error("pack succeeded but no .tgz was produced");
    }
    const tarball = await fsp.readFile(packedTarballFile);

    return { tarball, metadata };
  } finally {
    await fsp.rm(outputDir, { recursive: true, force: true });
  }
}

/** Read an existing npm `.tgz` package artifact and its embedded package.json metadata. */
export async function readPackageTarball(file: string): Promise<PackResult> {
  const tarball = await fsp.readFile(file);
  const tar = Buffer.from(await gunzipAsync(tarball));
  const metadata = parsePackageMetadata(extractPackageJsonFromTar(tar));
  return { tarball, metadata };
}

/** Summarize an npm `.tgz` package artifact for native `publish --json` projection fields. */
export async function summarizePackageTarball(tarball: Buffer): Promise<PackageTarballSummary> {
  const tar = Buffer.from(await gunzipAsync(tarball));
  return summarizeTar(tar);
}

/**
 * Preview the file list `npm pack` would include for a package directory, WITHOUT
 * producing a real tarball. Used to populate the WebUI's tarball preview during
 * the pending phase (before the user confirms) so the preview is available
 * immediately and is persisted with the event.
 *
 * Primary path: `npm pack --dry-run --json` — npm prints the exact file list
 * (path/size/mode) + unpackedSize, applying the same `files`/`.npmignore`/
 * `.gitignore` rules as a real publish. npm runs as its own subprocess, so the
 * caller's event loop never blocks on the pack walk.
 *
 * Fallback: if npm is absent or the dry-run fails, degrade to a real pack
 * (`packPackage` + `summarizePackageTarball`) so the preview keeps working in
 * every environment.
 */
export async function previewPackageFiles(dir: string): Promise<PackageTarballSummary> {
  try {
    const { stdout } = await execFile("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: dir,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Array<{
      files?: PackageTarballFile[];
      unpackedSize?: number;
      entryCount?: number;
      bundled?: string[];
    }>;
    const entry = parsed[0];
    if (!entry || !Array.isArray(entry.files)) {
      throw new Error("npm pack --dry-run produced no file list");
    }
    return {
      files: entry.files,
      unpackedSize: entry.unpackedSize ?? entry.files.reduce((s, f) => s + f.size, 0),
      entryCount: entry.entryCount ?? entry.files.length,
      bundled: entry.bundled ?? [],
    };
  } catch {
    // npm absent or dry-run failed — degrade to a real pack. Same code path
    // the publish flow uses, so the preview stays consistent.
    const { tarball } = await packPackage(dir, { ignoreScripts: true });
    return await summarizePackageTarball(tarball);
  }
}
