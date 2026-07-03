import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkPublishGitState } from "../../src/daemon/publish-git-checks.js";

const execFileAsync = promisify(execFile);
const sandbox = path.join(os.tmpdir(), `pnpm-pub-git-checks-${process.pid}-${Date.now()}`);
let originalLowerGitChecks: string | undefined;
let originalUpperGitChecks: string | undefined;
let originalLowerUserConfig: string | undefined;
let originalUpperUserConfig: string | undefined;
let originalLowerGlobalConfig: string | undefined;
let originalUpperGlobalConfig: string | undefined;
let originalLowerPrefix: string | undefined;
let originalUpperPrefix: string | undefined;
let originalPrefix: string | undefined;

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function createRepo(name: string, branch = "main"): Promise<string> {
  const repo = path.join(sandbox, name);
  await fsp.mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await fsp.writeFile(
    path.join(repo, "package.json"),
    `{"name":"${name}","version":"1.0.0"}\n`,
    "utf8",
  );
  await git(repo, ["add", "package.json"]);
  await git(repo, ["commit", "-q", "-m", "init"]);
  await git(repo, ["checkout", "-q", "-B", branch]);
  return repo;
}

async function createTrackedRepo(name: string): Promise<{ repo: string; origin: string }> {
  const origin = path.join(sandbox, `${name}.git`);
  const repo = path.join(sandbox, name);
  await execFileAsync("git", ["init", "--bare", "-q", origin]);
  await fsp.mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await fsp.writeFile(
    path.join(repo, "package.json"),
    `{"name":"${name}","version":"1.0.0"}\n`,
    "utf8",
  );
  await git(repo, ["add", "package.json"]);
  await git(repo, ["commit", "-q", "-m", "init"]);
  await git(repo, ["remote", "add", "origin", origin]);
  await git(repo, ["push", "-q", "-u", "origin", "main"]);
  await execFileAsync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
  return { repo, origin };
}

async function addRemoteCommit(origin: string, name: string): Promise<void> {
  const clone = path.join(sandbox, name);
  await execFileAsync("git", ["clone", "-q", origin, clone]);
  await git(clone, ["config", "user.email", "test@example.com"]);
  await git(clone, ["config", "user.name", "Test"]);
  await fsp.writeFile(path.join(clone, "REMOTE.md"), "remote\n", "utf8");
  await git(clone, ["add", "REMOTE.md"]);
  await git(clone, ["commit", "-q", "-m", "remote"]);
  await git(clone, ["push", "-q"]);
}

beforeEach(async () => {
  originalLowerGitChecks = process.env.npm_config_git_checks;
  originalUpperGitChecks = process.env.NPM_CONFIG_GIT_CHECKS;
  originalLowerUserConfig = process.env.npm_config_userconfig;
  originalUpperUserConfig = process.env.NPM_CONFIG_USERCONFIG;
  originalLowerGlobalConfig = process.env.npm_config_globalconfig;
  originalUpperGlobalConfig = process.env.NPM_CONFIG_GLOBALCONFIG;
  originalLowerPrefix = process.env.npm_config_prefix;
  originalUpperPrefix = process.env.NPM_CONFIG_PREFIX;
  originalPrefix = process.env.PREFIX;
  delete process.env.npm_config_git_checks;
  delete process.env.NPM_CONFIG_GIT_CHECKS;
  delete process.env.npm_config_userconfig;
  delete process.env.NPM_CONFIG_USERCONFIG;
  delete process.env.npm_config_globalconfig;
  delete process.env.NPM_CONFIG_GLOBALCONFIG;
  delete process.env.npm_config_prefix;
  delete process.env.NPM_CONFIG_PREFIX;
  delete process.env.PREFIX;
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  if (originalLowerGitChecks === undefined) delete process.env.npm_config_git_checks;
  else process.env.npm_config_git_checks = originalLowerGitChecks;
  if (originalUpperGitChecks === undefined) delete process.env.NPM_CONFIG_GIT_CHECKS;
  else process.env.NPM_CONFIG_GIT_CHECKS = originalUpperGitChecks;
  if (originalLowerUserConfig === undefined) delete process.env.npm_config_userconfig;
  else process.env.npm_config_userconfig = originalLowerUserConfig;
  if (originalUpperUserConfig === undefined) delete process.env.NPM_CONFIG_USERCONFIG;
  else process.env.NPM_CONFIG_USERCONFIG = originalUpperUserConfig;
  if (originalLowerGlobalConfig === undefined) delete process.env.npm_config_globalconfig;
  else process.env.npm_config_globalconfig = originalLowerGlobalConfig;
  if (originalUpperGlobalConfig === undefined) delete process.env.NPM_CONFIG_GLOBALCONFIG;
  else process.env.NPM_CONFIG_GLOBALCONFIG = originalUpperGlobalConfig;
  if (originalLowerPrefix === undefined) delete process.env.npm_config_prefix;
  else process.env.npm_config_prefix = originalLowerPrefix;
  if (originalUpperPrefix === undefined) delete process.env.NPM_CONFIG_PREFIX;
  else process.env.NPM_CONFIG_PREFIX = originalUpperPrefix;
  if (originalPrefix === undefined) delete process.env.PREFIX;
  else process.env.PREFIX = originalPrefix;
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe("Feature: publish git checks", () => {
  it("Scenario: Given a dirty worktree, When git checks are enabled, Then publish is blocked", async () => {
    const repo = await createRepo("dirty-package");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given a dirty worktree, When --no-git-checks is present, Then publish is allowed", async () => {
    const repo = await createRepo("dirty-bypass-package");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    await expect(checkPublishGitState(repo, ["--no-git-checks"])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given .npmrc disables git checks, When the worktree is dirty, Then publish is allowed", async () => {
    const repo = await createRepo("npmrc-dirty-bypass-package");
    await fsp.writeFile(path.join(repo, ".npmrc"), "git-checks=false\n", "utf8");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given .npmrc disables git checks, When CLI re-enables them, Then dirty publish is blocked", async () => {
    const repo = await createRepo("npmrc-cli-precedence-package");
    await fsp.writeFile(path.join(repo, ".npmrc"), "git-checks=false\n", "utf8");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, ["--git-checks"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given npm config env disables git checks, When the worktree is dirty, Then publish is allowed", async () => {
    const repo = await createRepo("env-dirty-bypass-package");
    process.env.NPM_CONFIG_GIT_CHECKS = "false";
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given npm config env disables git checks, When CLI re-enables them, Then dirty publish is blocked", async () => {
    const repo = await createRepo("cli-over-env-package");
    process.env.NPM_CONFIG_GIT_CHECKS = "false";
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, ["--git-checks"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given npm config env enables git checks over project config, When the worktree is dirty, Then publish is blocked", async () => {
    const repo = await createRepo("env-over-project-package");
    process.env.NPM_CONFIG_GIT_CHECKS = "true";
    await fsp.writeFile(path.join(repo, ".npmrc"), "git-checks=false\n", "utf8");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given user npm config disables git checks, When the worktree is dirty, Then publish is allowed", async () => {
    const repo = await createRepo("user-npmrc-dirty-bypass-package");
    const userConfig = path.join(sandbox, "user-npmrc");
    await fsp.writeFile(userConfig, "git-checks=false\n", "utf8");
    process.env.NPM_CONFIG_USERCONFIG = userConfig;
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given project .npmrc enables git checks over user config, When the worktree is dirty, Then publish is blocked", async () => {
    const repo = await createRepo("project-over-user-npmrc-package");
    const userConfig = path.join(sandbox, "project-over-user-npmrc");
    await fsp.writeFile(userConfig, "git-checks=false\n", "utf8");
    process.env.NPM_CONFIG_USERCONFIG = userConfig;
    await fsp.writeFile(path.join(repo, ".npmrc"), "git-checks=true\n", "utf8");
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given global npm config disables git checks, When the worktree is dirty, Then publish is allowed", async () => {
    const repo = await createRepo("global-npmrc-dirty-bypass-package");
    const globalConfig = path.join(sandbox, "global-npmrc");
    await fsp.writeFile(globalConfig, "git-checks=false\n", "utf8");
    process.env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given user npm config enables git checks over global config, When the worktree is dirty, Then publish is blocked", async () => {
    const repo = await createRepo("user-over-global-npmrc-package");
    const userConfig = path.join(sandbox, "user-over-global-npmrc");
    const globalConfig = path.join(sandbox, "user-over-global-global-npmrc");
    await fsp.writeFile(userConfig, "git-checks=true\n", "utf8");
    await fsp.writeFile(globalConfig, "git-checks=false\n", "utf8");
    process.env.NPM_CONFIG_USERCONFIG = userConfig;
    process.env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
    await fsp.writeFile(path.join(repo, "README.md"), "dirty\n", "utf8");

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Unclean working tree");
  });

  it("Scenario: Given a non-default branch, When publish-branch matches, Then publish is allowed", async () => {
    const repo = await createRepo("feature-package", "feature");

    await expect(checkPublishGitState(repo, ["--publish-branch", "feature"])).resolves.toEqual({
      ok: true,
    });
  });

  it("Scenario: Given .npmrc disables git checks, When on a non-default branch, Then publish is allowed", async () => {
    const repo = await createRepo("npmrc-feature-bypass-package", "feature");
    await fsp.writeFile(path.join(repo, ".npmrc"), "git-checks=false\n", "utf8");

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given a non-default branch, When publish-branch does not match, Then publish is blocked", async () => {
    const repo = await createRepo("wrong-branch-package", "feature");

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('branch "feature"');
    expect(result.error).toContain("master|main");
  });

  it("Scenario: Given fetched upstream history is ahead, When git checks are enabled, Then publish is blocked", async () => {
    const { repo, origin } = await createTrackedRepo("behind-upstream-package");
    await addRemoteCommit(origin, "behind-upstream-remote");
    await git(repo, ["fetch", "-q", "origin", "main"]);

    const result = await checkPublishGitState(repo, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Remote history differs");
  });

  it("Scenario: Given local history is only ahead of upstream, When git checks are enabled, Then publish is allowed", async () => {
    const { repo } = await createTrackedRepo("ahead-upstream-package");
    await fsp.writeFile(path.join(repo, "README.md"), "local\n", "utf8");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-q", "-m", "local"]);

    await expect(checkPublishGitState(repo, [])).resolves.toEqual({ ok: true });
  });

  it("Scenario: Given fetched upstream history is ahead, When --no-git-checks is present, Then publish is allowed", async () => {
    const { repo, origin } = await createTrackedRepo("behind-upstream-bypass-package");
    await addRemoteCommit(origin, "behind-upstream-bypass-remote");
    await git(repo, ["fetch", "-q", "origin", "main"]);

    await expect(checkPublishGitState(repo, ["--no-git-checks"])).resolves.toEqual({ ok: true });
  });
});
