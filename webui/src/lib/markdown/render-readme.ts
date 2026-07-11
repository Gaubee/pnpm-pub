import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import { README_REPOSITORY_PATH_TOKEN } from "$shared/readme.js";

import { safeSetHtml } from "../safe-html.js";

const preservedUrlPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#|\?)/i;

export interface ReadmeSource {
  pageUrl: URL;
  repositoryDirectory: string | null;
  repositoryBrowseFileTemplate: string | null;
  repositoryRawFileTemplate: string | null;
}

type ReadmeUrlKind = "link" | "asset";

/** Resolve a README-relative URL through a supported repository host. */
export function resolveReadmeUrl(
  value: string,
  source: Pick<
    ReadmeSource,
    "repositoryDirectory" | "repositoryBrowseFileTemplate" | "repositoryRawFileTemplate"
  >,
  kind: ReadmeUrlKind,
): string {
  const candidate = value.trim();
  if (!candidate || preservedUrlPattern.test(candidate)) return value;

  const template =
    kind === "link" ? source.repositoryBrowseFileTemplate : source.repositoryRawFileTemplate;
  if (!template?.includes(README_REPOSITORY_PATH_TOKEN)) return value;

  try {
    const relativeUrl = new URL(candidate, repositoryDirectoryBase(source.repositoryDirectory));
    const path = relativeUrl.pathname.replace(/^\//, "");
    if (!path) return value;

    const target = new URL(template.replace(README_REPOSITORY_PATH_TOKEN, path));
    target.search = relativeUrl.search;
    target.hash = relativeUrl.hash;
    return target.href;
  } catch {
    return value;
  }
}

/** Parse, sanitize, and enhance registry-supplied README Markdown. */
export function renderReadme(container: HTMLElement, markdown: string, source: ReadmeSource): void {
  const html = marked.parse(markdown, { async: false, gfm: true });
  safeSetHtml(container, html);

  rewriteReadmeUrls(container, source);
  enhanceLinks(container, source.pageUrl);
  enhanceImages(container);
  enhanceTaskInputs(container);
  enhanceTables(container);
  highlightCodeBlocks(container);
}

function rewriteReadmeUrls(container: HTMLElement, source: ReadmeSource): void {
  const urlAttributes = [
    ["a[href]", "href", "link"],
    ["img[src]", "src", "asset"],
    ["source[src]", "src", "asset"],
    ["video[src]", "src", "asset"],
    ["audio[src]", "src", "asset"],
  ] as const;

  for (const [selector, attribute, kind] of urlAttributes) {
    for (const element of container.querySelectorAll<HTMLElement>(selector)) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const resolved = resolveReadmeUrl(value, source, kind);
      if (resolved === value && isRelativeReadmeUrl(value)) {
        element.dataset.readmeUnresolvedUrl = value;
        element.removeAttribute(attribute);
        if (element instanceof HTMLAnchorElement) element.ariaDisabled = "true";
        continue;
      }
      element.setAttribute(attribute, resolved);
    }
  }
}

function repositoryDirectoryBase(directory: string | null): URL {
  const normalized = directory?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  return new URL(`https://readme.invalid/${normalized ? `${normalized}/` : ""}`);
}

function isRelativeReadmeUrl(value: string): boolean {
  const candidate = value.trim();
  return !!candidate && !preservedUrlPattern.test(candidate);
}

function enhanceLinks(container: HTMLElement, baseUrl: URL): void {
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    try {
      const url = new URL(anchor.href, baseUrl);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin !== baseUrl.origin
      ) {
        anchor.target = "_blank";
        anchor.rel = "nofollow noopener noreferrer";
      }
    } catch {
      // Keep malformed registry content inert instead of manufacturing a URL.
    }
  }
}

function enhanceImages(container: HTMLElement): void {
  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    image.loading = "lazy";
    image.decoding = "async";
  }
}

function enhanceTaskInputs(container: HTMLElement): void {
  for (const input of container.querySelectorAll<HTMLInputElement>("input")) {
    if (input.type !== "checkbox") {
      input.remove();
      continue;
    }
    input.disabled = true;
  }
}

function enhanceTables(container: HTMLElement): void {
  for (const table of container.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.classList.contains("readme-table-scroll")) continue;
    const wrapper = table.ownerDocument.createElement("div");
    wrapper.className = "readme-table-scroll";
    table.before(wrapper);
    wrapper.append(table);
  }
}

function highlightCodeBlocks(container: HTMLElement): void {
  for (const code of container.querySelectorAll<HTMLElement>("pre code")) {
    if (code.classList.contains("nohighlight")) continue;

    const language = explicitLanguage(code);
    const source = code.textContent ?? "";
    if (language && !hljs.getLanguage(language)) {
      code.classList.add("hljs");
      continue;
    }

    const result = language
      ? hljs.highlight(source, { language, ignoreIllegals: true })
      : hljs.highlightAuto(source);
    code.innerHTML = result.value;
    code.classList.add("hljs");
  }
}

function explicitLanguage(code: HTMLElement): string | null {
  for (const className of code.classList) {
    const match = /^(?:language|lang)-(.+)$/.exec(className);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}
