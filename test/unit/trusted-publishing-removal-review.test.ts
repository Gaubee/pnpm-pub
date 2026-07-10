import { describe, expect, it } from "vite-plus/test";
import type { TrustedPublisherRegistryConfig } from "../../webui/src/lib/types.js";
import { deriveRemovalReviewState } from "../../webui/src/lib/trusted-publishing.js";

const configs: TrustedPublisherRegistryConfig[] = [
  {
    id: "github-id",
    type: "github",
    permissions: ["createPackage"],
    claims: { repository: "owner/repo", workflow_ref: { file: "publish.yml" } },
  },
  {
    id: "gitlab-id",
    type: "gitlab",
    permissions: ["createPackage"],
    claims: { project_path: "owner/repo" },
  },
];

describe("Feature: per-config trusted-publisher removal review", () => {
  it("Scenario: Given only one config decided, When deriving review state, Then confirmation remains blocked", () => {
    expect(deriveRemovalReviewState(configs, { "github-id": "remove" })).toEqual({
      reviewed: false,
      hasRemove: true,
      remove: 1,
      keep: 0,
      unreviewed: 1,
    });
  });

  it("Scenario: Given every config kept, When deriving review state, Then no removal authority exists", () => {
    expect(
      deriveRemovalReviewState(configs, {
        "github-id": "keep",
        "gitlab-id": "keep",
      }),
    ).toEqual({
      reviewed: true,
      hasRemove: false,
      remove: 0,
      keep: 2,
      unreviewed: 0,
    });
  });

  it("Scenario: Given independent keep and remove decisions, When deriving review state, Then confirmation is authorized", () => {
    expect(
      deriveRemovalReviewState(configs, {
        "github-id": "remove",
        "gitlab-id": "keep",
      }),
    ).toEqual({
      reviewed: true,
      hasRemove: true,
      remove: 1,
      keep: 1,
      unreviewed: 0,
    });
  });
});
