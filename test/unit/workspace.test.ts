/**
 * Workspace scanner tests (Chapter 10.1.3).
 *
 * Exercises find-root, the pnpm-workspace.yaml priority path, the exclude
 * rules (node_modules / .git / private packages), and profile filtering.
 */
import { describe, it, expect } from "vite-plus/test";
import { makeVolume, ROOT } from "../helpers/memfs-adapter.js";
import {
  findProjectRoot,
  isRiskyRoot,
  readWorkspacePackages,
  scanWorkspace,
  filterByProfile,
  isPublishableByProfile,
} from "../../src/daemon/workspace.js";

describe("findProjectRoot (Chapter 5.3.1)", () => {
  it("returns the directory containing pnpm-workspace.yaml first", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/monorepo/pnpm-workspace.yaml`, "packages:\n  - packages/*");
    v.write(`${ROOT}/monorepo/packages/a/package.json`, '{"name":"a"}');
    const res = await findProjectRoot(`${ROOT}/monorepo/packages/a/src`, v.fs);
    expect(res.root).toBe(`${ROOT}/monorepo`);
    expect(res.matchedMarker).toBe("pnpm-workspace.yaml");
  });

  it("falls back to .git then package.json", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/repo/.git/HEAD`, "ref: refs/heads/main");
    v.write(`${ROOT}/repo/package.json`, '{"name":"repo"}');
    const res = await findProjectRoot(`${ROOT}/repo/src/deep`, v.fs);
    expect(res.root).toBe(`${ROOT}/repo`);
    expect(res.matchedMarker).toBe(".git");
  });

  it("returns null when no marker exists up to fs root (risk case)", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/loose/deep/file.txt`, "x");
    const res = await findProjectRoot(`${ROOT}/loose/deep`, v.fs);
    expect(res.root).toBeNull();
  });

  it("nested monorepo: pnpm-workspace.yaml wins over a nearer package.json", async () => {
    // Layout: monorepo/pnpm-workspace.yaml  (root)
    //         monorepo/packages/widget/package.json + .git
    // Scanning from widget/ should resolve to the workspace root, NOT the
    // nearer package.json/.git — that's the spec's priority rule (5.3.1).
    const v = makeVolume();
    v.write(`${ROOT}/mono/pnpm-workspace.yaml`, 'packages:\n  - "packages/*"');
    v.write(`${ROOT}/mono/package.json`, '{"name":"mono-root"}');
    v.write(`${ROOT}/mono/packages/widget/package.json`, '{"name":"widget"}');
    v.write(`${ROOT}/mono/packages/widget/.git/HEAD`, "ref: refs/heads/main");
    const res = await findProjectRoot(`${ROOT}/mono/packages/widget/src/lib`, v.fs);
    expect(res.root).toBe(`${ROOT}/mono`);
    expect(res.matchedMarker).toBe("pnpm-workspace.yaml");
  });
});

describe("isRiskyRoot (Chapter 5.3.2)", () => {
  const fs = makeVolume().fs;
  it("flags the filesystem root", () => {
    expect(isRiskyRoot("/", fs)).toBe(true);
  });
  it("flags the home directory", () => {
    expect(isRiskyRoot("/home/test", fs)).toBe(true);
  });
  it("flags Downloads/Desktop/etc by name", () => {
    expect(isRiskyRoot("/Users/x/Downloads", fs)).toBe(true);
    expect(isRiskyRoot("/Users/x/Desktop", fs)).toBe(true);
  });
  it("does not flag a real project directory", () => {
    expect(isRiskyRoot(`${ROOT}/my-project`, fs)).toBe(false);
  });
});

describe("readWorkspacePackages", () => {
  it("parses packages from pnpm-workspace.yaml", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/p/pnpm-workspace.yaml`, "packages:\n  - 'packages/*'\n  - 'tools/*'\n");
    const globs = await readWorkspacePackages(`${ROOT}/p`, v.fs);
    expect(globs).toEqual(["packages/*", "tools/*"]);
  });

  it("returns null when the file is absent", async () => {
    const v = makeVolume();
    expect(await readWorkspacePackages(`${ROOT}/p`, v.fs)).toBeNull();
  });
});

describe("scanWorkspace (Chapter 5.3.4 / 6.3.1)", () => {
  it("uses pnpm-workspace.yaml globs to locate packages", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/ws/pnpm-workspace.yaml`, 'packages:\n  - "packages/*"');
    v.write(`${ROOT}/ws/packages/@scope/a/package.json`, '{"name":"@scope/a","version":"1.0.0"}');
    v.write(`${ROOT}/ws/packages/b/package.json`, '{"name":"b","version":"2.0.0"}');
    // A decoy that should NOT be picked up (not under packages/).
    v.write(`${ROOT}/ws/decoy/package.json`, '{"name":"decoy"}');
    const pkgs = await scanWorkspace(`${ROOT}/ws`, v.fs, { root: `${ROOT}/ws` });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toContain("@scope/a");
    expect(names).toContain("b");
    expect(names).not.toContain("decoy");
  });

  it("excludes node_modules, .git, and private packages", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/plain/package.json`, '{"name":"plain","version":"0.1.0"}');
    v.write(`${ROOT}/plain/src/lib/package.json`, '{"name":"lib","version":"0.2.0"}');
    // private — must be skipped
    v.write(`${ROOT}/plain/internal/package.json`, '{"name":"internal","private":true}');
    // inside node_modules — must be skipped
    v.write(`${ROOT}/plain/node_modules/dep/package.json`, '{"name":"dep"}');
    const pkgs = await scanWorkspace(`${ROOT}/plain`, v.fs, { root: `${ROOT}/plain` });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["lib", "plain"]);
  });

  it("Scenario: Given package.json metadata is not an object, When scanning, Then it is not promoted into package facts", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/malformed/package.json`, "[]");
    v.write(`${ROOT}/malformed/packages/valid/package.json`, '{"name":"valid","version":"1.0.0"}');
    const pkgs = await scanWorkspace(`${ROOT}/malformed`, v.fs, { root: `${ROOT}/malformed` });
    expect(pkgs.map((pkg) => pkg.name)).toEqual(["valid"]);
  });

  it("preserves repository metadata from package.json", async () => {
    const v = makeVolume();
    v.write(
      `${ROOT}/repo/package.json`,
      '{"name":"repo","version":"1.0.0","repository":{"url":"https://github.com/acme/repo.git"}}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/repo`, v.fs, { root: `${ROOT}/repo` });
    expect(pkgs[0]?.repository).toBe("acme/repo");
  });

  it("Scenario: Given package publishConfig, When scanning, Then publish defaults remain package source facts", async () => {
    const v = makeVolume();
    v.write(
      `${ROOT}/publish-config/package.json`,
      JSON.stringify({
        name: "@scope/pkg",
        version: "1.0.0",
        publishConfig: {
          registry: "http://package-registry.test/",
          tag: "beta",
          access: "public",
        },
      }),
    );
    const pkgs = await scanWorkspace(`${ROOT}/publish-config`, v.fs, {
      root: `${ROOT}/publish-config`,
    });
    expect(pkgs[0]?.publishConfig).toEqual({
      registry: "http://package-registry.test/",
      tag: "beta",
      access: "public",
    });
  });

  it("Scenario: Given workspace dependency fields, When scanning, Then dependency names remain package source facts", async () => {
    const v = makeVolume();
    v.write(
      `${ROOT}/dependency-facts/package.json`,
      JSON.stringify({
        name: "app",
        version: "1.0.0",
        dependencies: { leaf: "workspace:*" },
        devDependencies: { testkit: "workspace:*" },
        optionalDependencies: { optional: "workspace:*" },
        peerDependencies: { peer: "^1.0.0" },
      }),
    );
    const pkgs = await scanWorkspace(`${ROOT}/dependency-facts`, v.fs, {
      root: `${ROOT}/dependency-facts`,
    });
    expect(pkgs[0]?.dependencyNames?.sort()).toEqual(["leaf", "optional", "peer", "testkit"]);
    expect(pkgs[0]?.productionDependencyNames?.sort()).toEqual(["leaf", "optional", "peer"]);
  });

  it("normalizes git+https repository URLs to a repo slug", async () => {
    const v = makeVolume();
    v.write(
      `${ROOT}/repo/package.json`,
      '{"name":"repo","version":"1.0.0","repository":"git+https://github.com/acme/repo.git"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/repo`, v.fs, { root: `${ROOT}/repo` });
    expect(pkgs[0]?.repository).toBe("acme/repo");
  });

  it("skips Git worktree isolated admin trees", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/repo/package.json`, '{"name":"repo","version":"1.0.0"}');
    v.write(
      `${ROOT}/repo/.git/worktrees/feature/package.json`,
      '{"name":"worktree-feature","version":"1.0.0"}',
    );
    v.write(
      `${ROOT}/repo/.git/worktrees/feature/src/package.json`,
      '{"name":"worktree-src","version":"1.0.0"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/repo`, v.fs, { root: `${ROOT}/repo` });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["repo"]);
  });

  it("honors .gitignore entries at root", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/gi/.gitignore`, "build\ncoverage\n");
    v.write(`${ROOT}/gi/package.json`, '{"name":"gi","version":"1.0.0"}');
    v.write(`${ROOT}/gi/build/pkg/package.json`, '{"name":"built"}');
    v.write(`${ROOT}/gi/coverage/pkg/package.json`, '{"name":"cov"}');
    const pkgs = await scanWorkspace(`${ROOT}/gi`, v.fs, {
      root: `${ROOT}/gi`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name);
    expect(names).toContain("gi");
    expect(names).not.toContain("built");
    expect(names).not.toContain("cov");
  });

  it("honors .gitignore entries in pnpm-workspace.yaml package globs", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/workspace/.gitignore`, "packages/generated\n");
    v.write(`${ROOT}/workspace/pnpm-workspace.yaml`, "packages:\n  - packages/*\n");
    v.write(`${ROOT}/workspace/packages/real/package.json`, '{"name":"real","version":"1.0.0"}');
    v.write(
      `${ROOT}/workspace/packages/generated/package.json`,
      '{"name":"generated","version":"1.0.0"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/workspace`, v.fs, {
      root: `${ROOT}/workspace`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["real"]);
  });

  it("honors wildcard .gitignore directory patterns during fallback scans", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/wild/.gitignore`, "packages/*/generated/\n");
    v.write(`${ROOT}/wild/package.json`, '{"name":"wild","version":"1.0.0"}');
    v.write(
      `${ROOT}/wild/packages/a/generated/package.json`,
      '{"name":"generated-a","version":"1.0.0"}',
    );
    v.write(`${ROOT}/wild/packages/a/real/package.json`, '{"name":"real-a","version":"1.0.0"}');
    const pkgs = await scanWorkspace(`${ROOT}/wild`, v.fs, {
      root: `${ROOT}/wild`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["real-a", "wild"]);
  });

  it("Scenario: Given a .gitignore name entry, When fallback scanning nested packages, Then matching directories are not package facts", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/named/.gitignore`, "generated\n");
    v.write(`${ROOT}/named/package.json`, '{"name":"named","version":"1.0.0"}');
    v.write(
      `${ROOT}/named/packages/a/generated/package.json`,
      '{"name":"generated-a","version":"1.0.0"}',
    );
    v.write(`${ROOT}/named/packages/a/real/package.json`, '{"name":"real-a","version":"1.0.0"}');
    const pkgs = await scanWorkspace(`${ROOT}/named`, v.fs, {
      root: `${ROOT}/named`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["named", "real-a"]);
  });

  it("Scenario: Given a .gitignore negation entry, When fallback scanning nested packages, Then re-included directories remain package facts", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/negated/.gitignore`, "packages/*\n!packages/keep\n");
    v.write(`${ROOT}/negated/package.json`, '{"name":"negated","version":"1.0.0"}');
    v.write(
      `${ROOT}/negated/packages/generated/package.json`,
      '{"name":"generated","version":"1.0.0"}',
    );
    v.write(`${ROOT}/negated/packages/keep/package.json`, '{"name":"keep","version":"1.0.0"}');
    const pkgs = await scanWorkspace(`${ROOT}/negated`, v.fs, {
      root: `${ROOT}/negated`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["keep", "negated"]);
  });

  it("honors wildcard .gitignore directory patterns in pnpm-workspace.yaml package globs", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/workspace-wild/.gitignore`, "packages/*/generated/\n");
    v.write(`${ROOT}/workspace-wild/pnpm-workspace.yaml`, "packages:\n  - packages/*/*\n");
    v.write(
      `${ROOT}/workspace-wild/packages/a/generated/package.json`,
      '{"name":"generated-a","version":"1.0.0"}',
    );
    v.write(
      `${ROOT}/workspace-wild/packages/a/real/package.json`,
      '{"name":"real-a","version":"1.0.0"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/workspace-wild`, v.fs, {
      root: `${ROOT}/workspace-wild`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["real-a"]);
  });

  it("Scenario: Given a .gitignore name entry, When pnpm-workspace globs match a package directory, Then that directory is skipped", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/workspace-named/.gitignore`, "generated\n");
    v.write(`${ROOT}/workspace-named/pnpm-workspace.yaml`, "packages:\n  - packages/*\n");
    v.write(
      `${ROOT}/workspace-named/packages/real/package.json`,
      '{"name":"real","version":"1.0.0"}',
    );
    v.write(
      `${ROOT}/workspace-named/packages/generated/package.json`,
      '{"name":"generated","version":"1.0.0"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/workspace-named`, v.fs, {
      root: `${ROOT}/workspace-named`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["real"]);
  });

  it("Scenario: Given a .gitignore negation entry, When pnpm-workspace globs match packages, Then re-included directories remain package facts", async () => {
    const v = makeVolume();
    v.write(`${ROOT}/workspace-negated/.gitignore`, "packages/*\n!packages/keep\n");
    v.write(`${ROOT}/workspace-negated/pnpm-workspace.yaml`, "packages:\n  - packages/*\n");
    v.write(
      `${ROOT}/workspace-negated/packages/generated/package.json`,
      '{"name":"generated","version":"1.0.0"}',
    );
    v.write(
      `${ROOT}/workspace-negated/packages/keep/package.json`,
      '{"name":"keep","version":"1.0.0"}',
    );
    const pkgs = await scanWorkspace(`${ROOT}/workspace-negated`, v.fs, {
      root: `${ROOT}/workspace-negated`,
      respectGitignore: true,
    });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(["keep"]);
  });
});

describe("filterByProfile (Chapter 5.3.5)", () => {
  const pkgs: ScannedPackage[] = [
    { name: "@org-admin/widget", version: "1.0.0", path: "/a" },
    { name: "@personal/blog", version: "2.0.0", path: "/b" },
    { name: "unscoped-pkg", version: "3.0.0", path: "/c" },
    { name: "@org-admin/private-thing", version: "0.0.1", private: true, path: "/d" },
  ];

  it("returns scoped packages matching the profile username + all unscoped", () => {
    const out = filterByProfile(pkgs, "org-admin").map((p) => p.name);
    expect(out).toContain("@org-admin/widget");
    expect(out).toContain("unscoped-pkg");
    expect(out).not.toContain("@personal/blog");
  });

  it("always drops private packages", () => {
    const out = filterByProfile(pkgs, "org-admin").map((p) => p.name);
    expect(out).not.toContain("@org-admin/private-thing");
  });

  it("matches case-insensitively", () => {
    const out = filterByProfile(pkgs, "ORG-ADMIN").map((p) => p.name);
    expect(out).toContain("@org-admin/widget");
  });

  it("Scenario: Given a sibling scoped package, When rendering workspace facts, Then publishability is a projection instead of a discovery filter", () => {
    const opentrayPackage = {
      name: "@opentray/ext-webview",
      version: "1.0.0",
      path: "/repo/packages/ext-webview",
    };
    expect(isPublishableByProfile(opentrayPackage, "kzf")).toBe(false);
    expect(isPublishableByProfile(opentrayPackage, "opentray")).toBe(true);
  });
});
