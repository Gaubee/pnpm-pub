import { describe, expect, it } from "vite-plus/test";
import {
  parsePublishAdvancedArgs,
  rebuildPublishAdvancedArgs,
} from "../../webui/src/lib/publish-advanced-args.js";

describe("Feature: WebUI Advanced publish args", () => {
  it("Scenario: Given empty publish args, When parsed, Then no-git-checks is off", () => {
    expect(parsePublishAdvancedArgs([]).noGitChecks).toBe(false);
  });

  it("Scenario: Given explicit no-git-checks args, When parsed, Then the switch is on", () => {
    expect(parsePublishAdvancedArgs(["--access", "public", "--no-git-checks"]).noGitChecks).toBe(
      true,
    );
  });

  it("Scenario: Given explicit git-checks args, When parsed, Then the switch is off", () => {
    expect(parsePublishAdvancedArgs(["--git-checks"]).noGitChecks).toBe(false);
  });

  it("Scenario: Given git-checks=false args, When parsed, Then the switch is on", () => {
    expect(parsePublishAdvancedArgs(["--git-checks=false"]).noGitChecks).toBe(true);
  });

  it("Scenario: Given conflicting git-check args, When parsed, Then the last flag wins", () => {
    expect(parsePublishAdvancedArgs(["--no-git-checks", "--git-checks"]).noGitChecks).toBe(false);
    expect(parsePublishAdvancedArgs(["--git-checks", "--no-git-checks"]).noGitChecks).toBe(true);
  });

  it("Scenario: Given unmanaged publish args, When no-git-checks is enabled, Then unmanaged args are preserved", () => {
    expect(
      rebuildPublishAdvancedArgs(["--dry-run", "--registry", "http://registry.test/", "--json"], {
        noGitChecks: true,
      }),
    ).toEqual(["--dry-run", "--registry", "http://registry.test/", "--json", "--no-git-checks"]);
  });

  it("Scenario: Given an existing no-git-checks flag, When disabled, Then only that flag is removed", () => {
    expect(
      rebuildPublishAdvancedArgs(["--dry-run", "--tag", "beta", "--no-git-checks"], {
        noGitChecks: false,
      }),
    ).toEqual(["--dry-run", "--tag", "beta"]);
  });

  it("Scenario: Given an explicit git-checks flag, When another control changes, Then git-checks stays explicit", () => {
    expect(rebuildPublishAdvancedArgs(["--git-checks"], { tag: "next" })).toEqual([
      "--tag",
      "next",
      "--git-checks",
    ]);
  });

  it("Scenario: Given recursive publish args, When rebuilt, Then recursive intent is preserved", () => {
    expect(
      rebuildPublishAdvancedArgs(["--dry-run"], { noGitChecks: true }, { recursive: true }),
    ).toEqual(["-r", "--dry-run", "--no-git-checks"]);
    expect(
      rebuildPublishAdvancedArgs(
        ["--recursive", "--dry-run"],
        { noGitChecks: true },
        {
          recursive: true,
        },
      ),
    ).toEqual(["--recursive", "--dry-run", "--no-git-checks"]);
  });

  it("Scenario: Given publish-branch is enabled, When rebuilt, Then no-git-checks is removed", () => {
    expect(
      rebuildPublishAdvancedArgs(["--no-git-checks"], {
        publishBranchOn: true,
        publishBranch: "main",
      }),
    ).toEqual(["--publish-branch", "main"]);
  });
});
