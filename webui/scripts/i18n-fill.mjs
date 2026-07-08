/**
 * One-shot locale backfill: add any keys present in `en` but missing from a
 * locale, using the `en` value as a placeholder (so the file type-checks and
 * i18n-check reports them as "untranslated" for later translation). Extra
 * (redundant) keys are left alone — remove those by hand.
 *
 * Usage:  node --import tsx scripts/i18n-fill.mjs
 * Idempotent: re-running is a no-op once all keys exist.
 */
import { writeFileSync } from "node:fs";

const ROOT = import.meta.dirname; // webui/scripts
const SRC = `${ROOT}/../src/locales`;

const { en } = await import(`${SRC}/en.ts`);
const LOCALES = ["zh", "es", "fr", "ar", "ru", "de", "ja", "ko"];

/** Deep-merge: locale wins; missing keys fall back to en (value copied).
 *  Walks BOTH trees in lockstep by en's shape. */
function mergeWithEn(enNode, localeNode) {
  const out = {};
  for (const key of Object.keys(enNode)) {
    const enVal = enNode[key];
    const locVal = localeNode?.[key];
    if (typeof enVal === "string") {
      out[key] = typeof locVal === "string" ? locVal : enVal;
    } else if (enVal && typeof enVal === "object") {
      out[key] = mergeWithEn(enVal, locVal && typeof locVal === "object" ? locVal : {});
    }
  }
  return out;
}

/** Serialize a message tree as a pretty 2-space-indented TS object literal. */
function serialize(obj, indent = "  ") {
  const lines = [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string") {
      lines.push(`${indent}${key}: ${JSON.stringify(value)},`);
    } else if (value && typeof value === "object") {
      lines.push(`${indent}${key}: {`);
      lines.push(serialize(value, indent + "  "));
      lines.push(`${indent}},`);
    }
  }
  return lines.join("\n");
}

let totalFilled = 0;

for (const loc of LOCALES) {
  const mod = await import(`${SRC}/${loc}.ts`);
  const dict = mod[loc];
  const before = countLeaves(dict);
  const merged = mergeWithEn(en, dict);
  const after = countLeaves(merged);
  const filled = after - before;
  totalFilled += filled;

  const body = serialize(merged, "  ");
  const file =
    `import type { Messages } from "./en.js";\n\n` +
    `// ${loc.toUpperCase()} — must structurally match \`Messages\` (derived from en).\n` +
    `// Missing or extra keys are compile errors. Keys whose value equals the en\n` +
    `// value are reported as "untranslated" by scripts/i18n-check.mjs.\n` +
    `export const ${loc}: Messages = {\n${body}\n};\n`;
  writeFileSync(`${SRC}/${loc}.ts`, file);
  console.log(`${loc}: ${before} → ${after} keys (filled ${filled})`);
}

function countLeaves(obj) {
  let n = 0;
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string") n++;
    else if (v && typeof v === "object") n += countLeaves(v);
  }
  return n;
}

console.log(`\nDone. Filled ${totalFilled} missing key(s) across ${LOCALES.length} locales.`);
