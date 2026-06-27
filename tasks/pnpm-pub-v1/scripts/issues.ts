#!/usr/bin/env tsx

import { mkdir, readFile, readdir, rename } from "node:fs/promises";

type IssueFrontMatter = {
  title?: unknown;
  state?: unknown;
  github_issue_status?: unknown;
  label?: unknown;
  milestone?: unknown;
  resolution?: unknown;
};

type IssueRecord = {
  path: string;
  title: string;
  state: string;
  githubIssueStatus: string;
  sections: string[];
};

const ISSUE_FILE_RE = /^\d{3,}-[a-z0-9][a-z0-9-]*\.md$/;
const FRONT_MATTER_KEYS = new Set([
  "title",
  "state",
  "github_issue_status",
  "label",
  "milestone",
  "resolution",
]);
const REQUIRED_SECTIONS = ["## Summary", "## Impact", "## Evidence"];

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const rootDir = positional[0] ?? process.cwd();
const command = positional[1] ?? "list";
const includeClosed = process.argv.includes("--include-closed");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (command === "archive-closed") {
  const archived = await archiveClosed(rootDir);
  for (const line of archived) console.log(line);
  process.exit(0);
}

const issues = await collectIssues(rootDir, { includeClosed });

switch (command) {
  case "list":
    for (const issue of issues) {
      console.log(`${issue.path}\t${issue.title}\t${issue.state}\t${issue.githubIssueStatus}`);
    }
    break;
  case "validate":
    if (issues.length === 0) {
      console.log("no valid issue files found");
      break;
    }
    for (const issue of issues) {
      console.log(`${issue.path}: ok`);
    }
    break;
  case "json":
    console.log(JSON.stringify(issues, null, 2));
    break;
  default:
    console.error(`unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

async function collectIssues(
  root: string,
  options: { includeClosed: boolean },
): Promise<IssueRecord[]> {
  const records: IssueRecord[] = [];
  for await (const file of walk(root)) {
    if (!file.endsWith(".md")) continue;
    if (!isIssueFilePath(file)) continue;
    if (!options.includeClosed && isClosedIssueFilePath(file)) continue;
    const parsed = await readIssue(file);
    if (parsed) records.push(parsed);
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}

async function archiveClosed(root: string): Promise<string[]> {
  const archived: string[] = [];
  const issues = await collectIssues(root, { includeClosed: false });
  for (const issue of issues) {
    if (issue.githubIssueStatus !== "closed") continue;
    const destination = archivePathFor(issue.path);
    if (destination === issue.path) continue;
    await mkdir(dirname(destination), { recursive: true });
    await rename(issue.path, destination);
    archived.push(`${issue.path} -> ${destination}`);
  }
  return archived;
}

async function readIssue(path: string): Promise<IssueRecord | null> {
  const text = await readFile(path, "utf8");
  const filename = basename(path);
  if (!ISSUE_FILE_RE.test(filename)) return null;

  const parsed = parseFrontMatter(text);
  if (!parsed) return null;

  const { frontMatter, body } = parsed;
  const title = asString(frontMatter.title);
  const state = asString(frontMatter.state);
  const githubIssueStatus = asString(frontMatter.github_issue_status);
  if (!title || !state || !githubIssueStatus) return null;
  if (!isAllowedState(state) || !isAllowedGithubStatus(githubIssueStatus)) return null;
  if (!hasRequiredSections(body)) return null;
  if (!frontMatterKeysValid(frontMatter)) return null;
  if (!hasRecommendationOrResolution(body)) return null;

  return {
    path,
    title,
    state,
    githubIssueStatus,
    sections: REQUIRED_SECTIONS.filter((section) => body.includes(section)),
  };
}

function parseFrontMatter(text: string): { frontMatter: IssueFrontMatter; body: string } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---\n")) return null;
  const end = trimmed.indexOf("\n---");
  if (end < 0) return null;
  const yamlText = trimmed.slice(4, end);
  const bodyStart = trimmed.indexOf("\n", end + 1);
  const body = bodyStart >= 0 ? trimmed.slice(bodyStart + 1) : "";
  return { frontMatter: parseYamlObject(yamlText), body };
}

function parseYamlObject(text: string): IssueFrontMatter {
  const result: IssueFrontMatter = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const raw = match[2];
    if (!key || raw === undefined) continue;
    result[key as keyof IssueFrontMatter] = raw.replace(/^"|"$/g, "");
  }
  return result;
}

function archivePathFor(path: string): string {
  const dir = dirname(path);
  const issuesDir = isIssuesDirName(basename(dir)) ? dir : findIssuesDir(dir);
  return `${issuesDir}/closed/${basename(path)}`;
}

function findIssuesDir(start: string): string {
  let current = start;
  while (true) {
    if (isIssuesDirName(basename(current))) return current;
    const parent = dirname(current);
    if (parent === current) return `${start}/.issues`;
    current = parent;
  }
}

function frontMatterKeysValid(frontMatter: IssueFrontMatter): boolean {
  return Object.keys(frontMatter).every((key) => FRONT_MATTER_KEYS.has(key));
}

function hasRequiredSections(body: string): boolean {
  return REQUIRED_SECTIONS.every((section) => body.includes(section));
}

function hasRecommendationOrResolution(body: string): boolean {
  return body.includes("## Recommendation") || body.includes("## Resolution");
}

function isAllowedState(value: string): boolean {
  return value === "open" || value === "resolved" || value === "closed";
}

function isAllowedGithubStatus(value: string): boolean {
  return value === "open" || value === "closed";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    yield path;
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || ".";
}

function isIssuesDirName(name: string): boolean {
  return name === "issues" || name === ".issues";
}

function isIssueFilePath(path: string): boolean {
  return /(^|[\\/])\.?issues([\\/]|$)/.test(path);
}

function isClosedIssueFilePath(path: string): boolean {
  return /(^|[\\/])\.?issues([\\/])closed([\\/]|$)/.test(path);
}

function printHelp(): void {
  console.log(`usage: bun tasks/pnpm-pub-v1/scripts/issues.ts [root-dir] [list|validate|json|archive-closed]
options:
  --include-closed  include archived issue files under .issues/closed or issues/closed`);
}
