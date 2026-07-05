import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vite-plus/test";
import {
  OIDC_WORKFLOW_PATH,
  previewPublishWorkflow,
  writePublishWorkflow,
} from "../../src/daemon/oidc-workflow.js";
import type { TrustedPublisherConfig } from "../../src/shared/index.js";

const githubConfig: TrustedPublisherConfig = {
  id: "trust-id",
  type: "github",
  permissions: ["createPackage"],
  claims: {
    repository: "owner/repo",
    workflow_ref: { file: "publish.yml@refs/heads/release" },
    environment: "npm",
  },
};

describe("Feature: setup-oidc local workflow RPC utility", () => {
  it("Scenario: Given a GitHub trusted publisher, When previewed, Then no file is written and yml is derived from Current", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pnpm-pub-oidc-preview-"));
    try {
      const preview = await previewPublishWorkflow(root, githubConfig);
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.path).toBe(path.join(root, OIDC_WORKFLOW_PATH));
      expect(preview.exists).toBe(false);
      expect(preview.content).toContain("branches: [release]");
      expect(preview.content).toContain("environment: npm");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("Scenario: Given an existing workflow, When writing without force, Then the local file is conserved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pnpm-pub-oidc-write-"));
    const workflowPath = path.join(root, OIDC_WORKFLOW_PATH);
    try {
      await mkdir(path.dirname(workflowPath), { recursive: true });
      await writeFile(workflowPath, "existing", "utf8");
      const result = await writePublishWorkflow(root, githubConfig);
      expect(result.ok).toBe(false);
      expect(await readFile(workflowPath, "utf8")).toBe("existing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
