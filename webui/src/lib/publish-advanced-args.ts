export type PublishAdvancedAccess = "public" | "restricted";

export interface PublishAdvancedArgsState {
  access: PublishAdvancedAccess;
  accessExplicit: boolean;
  tag: string;
  tagExplicit: boolean;
  ignoreScripts: boolean;
  gitChecksCli: boolean | undefined;
  noGitChecks: boolean;
  publishBranchOn: boolean;
  publishBranch: string;
  recursive: boolean;
}

export interface PublishAdvancedArgsOverrides {
  access?: PublishAdvancedAccess;
  tag?: string;
  ignoreScripts?: boolean;
  noGitChecks?: boolean;
  publishBranchOn?: boolean;
  publishBranch?: string;
}

export interface RebuildPublishAdvancedArgsOptions {
  recursive?: boolean;
}

const VALUE_FLAGS = new Set(["--access", "--tag", "--publish-branch"]);
const MANAGED_FLAGS = new Set([
  "--access",
  "--tag",
  "--ignore-scripts",
  "--no-git-checks",
  "--git-checks",
  "--publish-branch",
]);

export function parsePublishAdvancedArgs(args: readonly string[]): PublishAdvancedArgsState {
  const accessValue = argValue(args, "--access");
  const tagValue = argValue(args, "--tag");
  const gitChecksCli = readCliGitChecks(args);
  const publishBranch = argValue(args, "--publish-branch");

  return {
    access: accessValue === "restricted" ? "restricted" : "public",
    accessExplicit: accessValue !== undefined,
    tag: tagValue ?? "",
    tagExplicit: tagValue !== undefined,
    ignoreScripts: args.includes("--ignore-scripts"),
    gitChecksCli,
    noGitChecks: gitChecksCli === false,
    publishBranchOn: publishBranch !== undefined,
    publishBranch: publishBranch ?? "",
    recursive: hasRecursiveFlag(args),
  };
}

export function rebuildPublishAdvancedArgs(
  args: readonly string[],
  overrides: PublishAdvancedArgsOverrides = {},
  options: RebuildPublishAdvancedArgsOptions = {},
): string[] {
  const state = parsePublishAdvancedArgs(args);
  const next = stripManagedArgs(args);
  const recursive = options.recursive ?? state.recursive;

  if (recursive && !hasRecursiveFlag(next)) next.unshift("-r");

  const access = overrides.access ?? state.access;
  const accessExplicit = overrides.access !== undefined || state.accessExplicit;
  if (accessExplicit) next.push("--access", access);

  const tag = overrides.tag !== undefined ? overrides.tag : state.tag;
  const tagExplicit = overrides.tag !== undefined || state.tagExplicit;
  if (tagExplicit && tag.length > 0 && (overrides.tag === undefined || tag !== "latest")) {
    next.push("--tag", tag);
  }

  const ignoreScripts = overrides.ignoreScripts ?? state.ignoreScripts;
  if (ignoreScripts) next.push("--ignore-scripts");

  const publishBranchOn = overrides.publishBranchOn ?? state.publishBranchOn;
  const publishBranch =
    overrides.publishBranch !== undefined ? overrides.publishBranch : state.publishBranch;
  const noGitChecks = publishBranchOn ? false : (overrides.noGitChecks ?? state.noGitChecks);
  if (noGitChecks) {
    next.push("--no-git-checks");
  } else if (overrides.noGitChecks === undefined && state.gitChecksCli === true) {
    next.push("--git-checks");
  }

  if (publishBranchOn && publishBranch.length > 0) {
    next.push("--publish-branch", publishBranch);
  }

  return next;
}

function argValue(args: readonly string[], flag: string): string | undefined {
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === flag) {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) value = next;
      continue;
    }
    if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1);
  }
  return value;
}

function readCliGitChecks(args: readonly string[]): boolean | undefined {
  let enabled: boolean | undefined;
  for (const arg of args) {
    if (arg === "--no-git-checks") enabled = false;
    if (arg === "--git-checks") enabled = true;
    if (arg.startsWith("--git-checks=")) enabled = arg.slice("--git-checks=".length) !== "false";
  }
  return enabled;
}

function hasRecursiveFlag(args: readonly string[]): boolean {
  return args.includes("-r") || args.includes("--recursive");
}

function stripManagedArgs(args: readonly string[]): string[] {
  const next: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!MANAGED_FLAGS.has(flag)) {
      next.push(arg);
      continue;
    }
    if (VALUE_FLAGS.has(flag) && arg === flag) {
      const value = args[index + 1];
      if (value && !value.startsWith("-")) index += 1;
    }
  }
  return next;
}
