/**
 * Unit tests for the trusted-publisher config equality helper that drives the
 * skip/conflict pre-flight (Chapter 6.2.7). Mirrored on both sides; the webui
 * helper is the canonical source and the daemon mirrors it.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  extractTrustedPublishingValues,
  trustedPublisherConfigsEqual,
} from "../../webui/src/lib/trusted-publishing.js";
import type {
  TrustedPublisherConfig,
  TrustedPublisherCreateConfig,
} from "../../webui/src/lib/types.js";

const githubCreate = (
  overrides: Partial<{ repository: string; file: string; environment: string }> = {},
): TrustedPublisherCreateConfig => ({
  type: "github",
  permissions: ["createPackage", "createStagedPackage"],
  claims: {
    repository: overrides.repository ?? "o/r",
    workflow_ref: { file: overrides.file ?? "publish.yml" },
    ...(overrides.environment ? { environment: overrides.environment } : {}),
  },
});

const githubExisting = (
  id: string,
  overrides: Partial<{ repository: string; file: string; environment: string }> = {},
): TrustedPublisherConfig => ({
  id,
  type: "github",
  permissions: ["createPackage", "createStagedPackage"],
  claims: {
    repository: overrides.repository ?? "o/r",
    workflow_ref: { file: overrides.file ?? "publish.yml" },
    ...(overrides.environment ? { environment: overrides.environment } : {}),
  },
});

describe("Feature: trusted publisher config equality (skip/conflict pre-flight)", () => {
  it("Scenario: Given identical configs, When comparing, Then they are equal (ignoring the registry id)", () => {
    expect(trustedPublisherConfigsEqual(githubCreate(), githubExisting("uuid-1"))).toBe(true);
  });

  it("Scenario: Given configs differing only by id, When comparing, Then they are equal", () => {
    expect(trustedPublisherConfigsEqual(githubCreate(), githubExisting("different-id"))).toBe(true);
  });

  it("Scenario: Given configs differing by repository, When comparing, Then they are NOT equal (conflict)", () => {
    expect(
      trustedPublisherConfigsEqual(
        githubCreate({ repository: "o/r" }),
        githubExisting("id", { repository: "o/other" }),
      ),
    ).toBe(false);
  });

  it("Scenario: Given configs differing by workflow file, When comparing, Then they are NOT equal", () => {
    expect(
      trustedPublisherConfigsEqual(
        githubCreate({ file: "a.yml" }),
        githubExisting("id", { file: "b.yml" }),
      ),
    ).toBe(false);
  });

  it("Scenario: Given configs of different provider types, When comparing, Then they are NOT equal", () => {
    const circleci: TrustedPublisherCreateConfig = {
      type: "circleci",
      permissions: ["createPackage"],
      claims: {
        "oidc.circleci.com/org-id": "org",
        "oidc.circleci.com/project-id": "proj",
        "oidc.circleci.com/pipeline-definition-id": "pipe",
        "oidc.circleci.com/vcs-origin": "github.com/o/r",
      },
    };
    expect(trustedPublisherConfigsEqual(circleci, githubExisting("id"))).toBe(false);
  });

  it("Scenario: Given CircleCI create vs existing with same context-ids (array vs absent), When comparing, Then context-ids normalize", () => {
    const a: TrustedPublisherCreateConfig = {
      type: "circleci",
      permissions: ["createPackage"],
      claims: {
        "oidc.circleci.com/org-id": "org",
        "oidc.circleci.com/project-id": "proj",
        "oidc.circleci.com/pipeline-definition-id": "pipe",
        "oidc.circleci.com/vcs-origin": "github.com/o/r",
        "oidc.circleci.com/context-ids": ["c1", "c2"],
      },
    };
    const b = {
      id: "x",
      type: "circleci",
      permissions: ["createPackage"],
      claims: {
        "oidc.circleci.com/org-id": "org",
        "oidc.circleci.com/project-id": "proj",
        "oidc.circleci.com/pipeline-definition-id": "pipe",
        "oidc.circleci.com/vcs-origin": "github.com/o/r",
        "oidc.circleci.com/context-ids": ["c1", "c2"],
      },
    } as TrustedPublisherConfig;
    expect(trustedPublisherConfigsEqual(a, b)).toBe(true);
  });

  it("Scenario: Given configs differing by permissions, When comparing, Then they are NOT equal", () => {
    const desired: TrustedPublisherCreateConfig = {
      type: "github",
      permissions: ["createPackage"],
      claims: { repository: "o/r", workflow_ref: { file: "publish.yml" } },
    };
    const existing: TrustedPublisherConfig = {
      id: "x",
      type: "github",
      permissions: ["createPackage", "createStagedPackage"],
      claims: { repository: "o/r", workflow_ref: { file: "publish.yml" } },
    };
    expect(trustedPublisherConfigsEqual(desired, existing)).toBe(false);
  });

  it("Scenario: Given a config, When extracting values, Then the id is dropped", () => {
    const v = extractTrustedPublishingValues(githubExisting("any-id"));
    expect(v.repoOwner).toBe("o");
    expect(v.repoName).toBe("r");
    expect(v.workflowFile).toBe("publish.yml");
    expect("id" in v).toBe(false);
  });
});
