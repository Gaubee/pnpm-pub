/**
 * i18n key-parity + translation-coverage check.
 *
 * Runs over the locale modules in `src/locales/`. `en` is the source of truth;
 * every other locale must be structurally identical (same leaf keys). This
 * script is a runtime mirror of the compile-time `Messages` type check — it
 * catches the same drift (missing/extra keys) plus reports UNTRANSLATED keys
 * (a leaf whose value equals the `en` value), which the type system cannot.
 *
 * Usage:
 *   node --import tsx scripts/i18n-check.mjs          # errors fail, warnings pass
 *   node --import tsx scripts/i18n-check.mjs --strict  # warnings also fail
 *
 * Exit codes: 0 ok (or warnings-only, non-strict) · 1 errors (or warnings, strict)
 */
// `en` is exported with `as const`; at runtime it's a plain object. tsx
// resolves the .ts import so we can read the live values.
const { en } = await import("../src/locales/en.ts");
const LOCALES = ["zh", "es", "fr", "ar", "ru", "de", "ja", "ko"];

/** Flatten a nested message tree into dot-path → string leaves. */
function flatten(obj, prefix = "", out = {}) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object") {
      flatten(value, path, out);
    }
  }
  return out;
}

const enLeaves = flatten(en);

let errorCount = 0;
let warnCount = 0;
const strict = process.argv.includes("--strict");

for (const loc of LOCALES) {
  const mod = await import(`../src/locales/${loc}.ts`);
  const dict = mod[loc];
  if (!dict) {
    console.error(`✗ ${loc}: module did not export "${loc}"`);
    errorCount++;
    continue;
  }
  const locLeaves = flatten(dict);

  const missing = [];
  const extra = [];
  const untranslated = [];

  for (const key of Object.keys(enLeaves)) {
    if (!(key in locLeaves)) {
      missing.push(key);
    } else if (locLeaves[key] === enLeaves[key]) {
      untranslated.push(key);
    }
  }
  for (const key of Object.keys(locLeaves)) {
    if (!(key in enLeaves)) extra.push(key);
  }

  if (missing.length || extra.length || untranslated.length) {
    console.log(`\n${loc}`);
    if (missing.length) {
      console.log(`  ✗ missing (${missing.length}):`);
      for (const k of missing) console.log(`      ${k}`);
    }
    if (extra.length) {
      console.log(`  ✗ extra/redundant (${extra.length}):`);
      for (const k of extra) console.log(`      ${k}`);
    }
    if (untranslated.length) {
      console.log(`  ⚠ untranslated (value === en, ${untranslated.length}):`);
      // Collapse long lists to the first 20 + a count.
      const shown = untranslated.slice(0, 20);
      for (const k of shown) console.log(`      ${k}`);
      if (untranslated.length > 20) {
        console.log(`      …and ${untranslated.length - 20} more`);
      }
    }
  }

  errorCount += missing.length + extra.length;
  warnCount += untranslated.length;
}

console.log(
  `\n${errorCount} error(s), ${warnCount} untranslated warning(s)` +
    (strict ? " (strict: warnings fail)" : "") +
    ".",
);

if (errorCount > 0 || (strict && warnCount > 0)) {
  process.exit(1);
}
