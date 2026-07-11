// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { renderReadme, resolveReadmeUrl } from "../../webui/src/lib/markdown/render-readme.js";

describe("Feature: package README projection", () => {
  it("Scenario: Given GitHub-backed Markdown and HTML URLs, When rendered, Then links browse files and assets use raw content", () => {
    const container = document.createElement("div");
    const pageUrl = new URL("http://127.0.0.1:57915/packages/pnpm-pub#token=secret");

    renderReadme(
      container,
      [
        "[Guide](docs/guide.md)",
        '<img src="docs/images/pnpm-pub-1.0.0.png" alt="pnpm-pub tray">',
      ].join("\n\n"),
      {
        pageUrl,
        repositoryDirectory: null,
        repositoryBrowseFileTemplate:
          "https://github.com/Gaubee/pnpm-pub/blob/HEAD/__PNPM_PUB_README_PATH__",
        repositoryRawFileTemplate:
          "https://raw.githubusercontent.com/Gaubee/pnpm-pub/HEAD/__PNPM_PUB_README_PATH__",
      },
    );

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://github.com/Gaubee/pnpm-pub/blob/HEAD/docs/guide.md",
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://raw.githubusercontent.com/Gaubee/pnpm-pub/HEAD/docs/images/pnpm-pub-1.0.0.png",
    );
    expect(container.querySelector("img")?.loading).toBe("lazy");
  });

  it.each([
    {
      host: "GitLab",
      browseFileTemplate: "https://gitlab.com/group/pkg/tree/HEAD/__PNPM_PUB_README_PATH__",
      rawFileTemplate: "https://gitlab.com/group/pkg/raw/HEAD/__PNPM_PUB_README_PATH__",
      expectedLink: "https://gitlab.com/group/pkg/tree/HEAD/packages/shared/guide.md",
      expectedAsset: "https://gitlab.com/group/pkg/raw/HEAD/packages/shared/image.png",
    },
    {
      host: "Bitbucket",
      browseFileTemplate: "https://bitbucket.org/team/pkg/src/HEAD/__PNPM_PUB_README_PATH__",
      rawFileTemplate: "https://bitbucket.org/team/pkg/raw/HEAD/__PNPM_PUB_README_PATH__",
      expectedLink: "https://bitbucket.org/team/pkg/src/HEAD/packages/shared/guide.md",
      expectedAsset: "https://bitbucket.org/team/pkg/raw/HEAD/packages/shared/image.png",
    },
    {
      host: "SourceHut",
      browseFileTemplate: "https://git.sr.ht/~team/pkg/tree/HEAD/__PNPM_PUB_README_PATH__",
      rawFileTemplate: "https://git.sr.ht/~team/pkg/blob/HEAD/__PNPM_PUB_README_PATH__",
      expectedLink: "https://git.sr.ht/~team/pkg/tree/HEAD/packages/shared/guide.md",
      expectedAsset: "https://git.sr.ht/~team/pkg/blob/HEAD/packages/shared/image.png",
    },
  ])(
    "Scenario: Given a $host monorepo package, When resolving relative URLs, Then the host contract and package directory are preserved",
    ({ browseFileTemplate, rawFileTemplate, expectedLink, expectedAsset }) => {
      const source = {
        repositoryDirectory: "packages/ui",
        repositoryBrowseFileTemplate: browseFileTemplate,
        repositoryRawFileTemplate: rawFileTemplate,
      };
      expect(resolveReadmeUrl("../shared/guide.md", source, "link")).toBe(expectedLink);
      expect(resolveReadmeUrl("../shared/image.png", source, "asset")).toBe(expectedAsset);
    },
  );

  it("Scenario: Given absolute, fragment, or unsupported-host links, When resolved, Then source URLs remain unchanged", () => {
    const source = {
      repositoryDirectory: null,
      repositoryBrowseFileTemplate: null,
      repositoryRawFileTemplate: null,
    };

    expect(resolveReadmeUrl("https://example.com/guide", source, "link")).toBe(
      "https://example.com/guide",
    );
    expect(resolveReadmeUrl("#usage", source, "link")).toBe("#usage");
    expect(resolveReadmeUrl("../LICENSE", source, "link")).toBe("../LICENSE");
  });

  it("Scenario: Given unresolved relative resources and raw inputs, When rendered, Then false navigation and interactive HTML are disabled", () => {
    const container = document.createElement("div");

    renderReadme(
      container,
      [
        "[Guide](docs/guide.md)",
        '<img src="images/logo.png" alt="logo">',
        '<input type="text" value="unsafe"><input type="checkbox" checked>',
      ].join("\n\n"),
      {
        pageUrl: new URL("http://127.0.0.1:57915/packages/pkg"),
        repositoryDirectory: null,
        repositoryBrowseFileTemplate: null,
        repositoryRawFileTemplate: null,
      },
    );

    const link = container.querySelector("a");
    const image = container.querySelector("img");
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.dataset.readmeUnresolvedUrl).toBe("docs/guide.md");
    expect(image?.hasAttribute("src")).toBe(false);
    expect(image?.dataset.readmeUnresolvedUrl).toBe("images/logo.png");
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(
      true,
    );
  });

  it("Scenario: Given fenced TypeScript and a wide table, When rendered, Then syntax and overflow affordances are projected", () => {
    const container = document.createElement("div");

    renderReadme(
      container,
      [
        "```ts",
        'const packageName: string = "pnpm-pub";',
        "```",
        "",
        "| Package | Status |",
        "| --- | --- |",
        "| pnpm-pub | ready |",
      ].join("\n"),
      {
        pageUrl: new URL("http://127.0.0.1:57915/packages/pnpm-pub"),
        repositoryDirectory: null,
        repositoryBrowseFileTemplate: null,
        repositoryRawFileTemplate: null,
      },
    );

    expect(container.querySelector("pre code")?.classList.contains("hljs")).toBe(true);
    expect(container.querySelector("pre code .hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector(".readme-table-scroll > table")).not.toBeNull();
  });
});
