/**
 * Safe HTML injection for untrusted (registry-supplied) README HTML.
 *
 * Primary path: the standard DOM Sanitizer API (`Element.prototype.setHTML`),
 * which parses + sanitizes in one browser-native step with no dependency. This
 * is available in Chromium ≥105 / Safari ≥17 / Firefox ≥128 (i.e. every desktop
 * runtime pnpm-pub targets, since the WebUI ships in an embedded webview).
 *
 * Fallback: when `setHTML` is unavailable (older webview), a minimal manual
 * scrub runs — strip `<script>`/`<style>`/event-handler attributes and
 * `javascript:`/`data:` hrefs — before assigning `innerHTML`. The Sanitizer
 * API path is strongly preferred; the fallback is a best-effort backstop only.
 */

// The TS lib.dom bundled by this toolchain pre-dates the Sanitizer API, so
// declare `Element.setHTML` locally. The runtime check (`typeof ... ===
// 'function'`) keeps behavior correct even where the type exists but the
// method does not (older webview).
interface ElementWithSetHTML extends Element {
  setHTML?(
    input: string,
    options?: {
      sanitizer?: {
        allowElements?: string[];
        blockElements?: string[];
        dropElements?: string[];
        allowAttributes?: Record<string, string[]>;
        blockAttributes?: Record<string, string[]>;
        dropAttributes?: Record<string, string[]>;
        allowCustomElements?: boolean;
        allowComments?: boolean;
      };
    },
  ): void;
}

/** True when the host supports the native Sanitizer API (`Element.setHTML`). */
const supportsSetHtml =
  typeof Element !== "undefined" &&
  typeof (Element.prototype as unknown as ElementWithSetHTML).setHTML === "function";

/**
 * Drop nodes whose tag is in `tags` (case-insensitive), plus any element
 * carrying an `on*` event-handler attribute or a `javascript:`/`data:` URL in
 * a known sink attribute. Mutates + returns the same root.
 */
function scrubNode(root: ParentNode): ParentNode {
  for (const tag of ["script", "style", "iframe", "object", "embed", "link", "meta", "base"]) {
    root.querySelectorAll(tag).forEach((el) => el.remove());
  }
  const sinkAttrs = ["href", "src", "xlink:href", "action", "formAction", "background"];
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        sinkAttrs.includes(name) &&
        (value.startsWith("javascript:") || value.startsWith("data:text/html"))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return root;
}

/**
 * Inject `html` into `el` safely. The Sanitizer API path leaves `el` populated
 * with a sanitized DOM; the fallback assigns scrubbed `innerHTML`.
 */
export function safeSetHtml(el: Element, html: string): void {
  const target = el as ElementWithSetHTML;
  if (supportsSetHtml && typeof target.setHTML === "function") {
    target.setHTML(html);
    return;
  }
  // Fallback: parse into a detached template, scrub, then adopt.
  const template = document.createElement("template");
  template.innerHTML = html;
  scrubNode(template.content);
  el.replaceChildren(template.content.cloneNode(true));
}
