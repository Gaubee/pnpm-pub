/**
 * Apply curated translations to locale files.
 *
 * For each non-en locale: start from `en` (guarantees full key coverage), then
 * overlay the locale's EXISTING translated values, then overlay the curated
 * translations from `scripts/translations/<locale>.json`. The result is a
 * fully-covered, fully-translated dictionary, written back as a typed
 * `const xx: Messages = {...}` module.
 *
 * Layering (last wins): en shape → existing locale values → curated JSON.
 * This keeps already-translated keys and only fills/overrides the curated set.
 *
 * Usage:  node --import tsx scripts/i18n-translate.mjs
 * Idempotent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = import.meta.dirname; // webui/scripts
const SRC = `${ROOT}/../src/locales`;
const TRANS = `${ROOT}/translations`;

const { en } = await import(`${SRC}/en.ts`);
const LOCALES = ["zh", "es", "fr", "ar", "ru", "de", "ja", "ko"];

/** Flatten a message tree to dot-path → string. */
function flatten(obj, prefix = "", out = {}) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") flatten(value, path, out);
  }
  return out;
}

/** Rebuild a tree from dot-path → string, following en's shape (so nesting
 *  and key order match en). */
function rebuildFromLeaves(enNode, leaves, prefix = "") {
  const out = {};
  for (const key of Object.keys(enNode)) {
    const enVal = enNode[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof enVal === "string") {
      out[key] = leaves[path] ?? enVal;
    } else if (enVal && typeof enVal === "object") {
      out[key] = rebuildFromLeaves(enVal, leaves, path);
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

let totalApplied = 0;

for (const loc of LOCALES) {
  const enLeaves = flatten(en);
  const mod = await import(`${SRC}/${loc}.ts`);
  const existingLeaves = flatten(mod[loc]);
  const curatedRaw = readFileSync(`${TRANS}/${loc}.json`, "utf8");
  const curated = JSON.parse(curatedRaw);

  // Layer: en value (default) → existing locale value → curated translation.
  const mergedLeaves = {};
  for (const key of Object.keys(enLeaves)) {
    let val = enLeaves[key];
    if (key in existingLeaves) val = existingLeaves[key];
    if (key in curated) val = curated[key];
    mergedLeaves[key] = val;
  }

  const applied = Object.keys(curated).filter(
    (k) => curated[k] !== (existingLeaves[k] ?? enLeaves[k]),
  ).length;
  totalApplied += applied;

  const tree = rebuildFromLeaves(en, mergedLeaves);
  const body = serialize(tree, "  ");
  const file =
    `import type { Messages } from "./en.js";\n\n` +
    `// ${loc.toUpperCase()} — must structurally match \`Messages\` (derived from en).\n` +
    `// Missing or extra keys are compile errors. Keys whose value equals the en\n` +
    `// value are reported as "untranslated" by scripts/i18n-check.mjs.\n` +
    `export const ${loc}: Messages = {\n${body}\n};\n`;
  writeFileSync(`${SRC}/${loc}.ts`, file);
  console.log(`${loc}: applied ${applied} curated translation(s)`);
}

console.log(`\nDone. Applied ${totalApplied} translation(s) across ${LOCALES.length} locales.`);
