/**
 * Locale registry + on-demand loader.
 *
 * `en` is the source-of-truth AND the synchronous fallback (always in the
 * initial bundle so SSR/first paint never renders empty strings). Every other
 * locale is loaded ON DEMAND via a dynamic `import()` — each becomes its own
 * chunk, so a user on `zh` never pays for `fr`/`ar`/etc. svelte-i18n's
 * `registerLocaleLoader` + `waitLocale` drive the async wiring.
 *
 * Locale dictionaries live in sibling files (`en.ts`, `zh.ts`, …) and are
 * type-checked against `Messages` (derived from `en`) so missing/extra keys
 * are compile errors. Run `pnpm i18n:check` for untranslated-coverage reports.
 */
import { browser } from "$app/environment";
import { addMessages, init, locale, register, waitLocale } from "svelte-i18n";
import { en, type Messages } from "./en.js";

export type { Messages };

export const locales = ["en", "zh", "es", "fr", "ar", "ru", "de", "ja", "ko"] as const;

export type AppLocale = (typeof locales)[number];

export const localeNames: Record<AppLocale, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
  fr: "Français",
  ar: "العربية",
  ru: "Русский",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
};

const defaultLocale: AppLocale = "en";
const localeStorageKey = "pnpm-pub.locale";

/** Dynamic-import loaders for every non-en locale → independent chunks.
 *  Each module exports its dictionary as a NAMED export (`export const zh`). */
const loaders: Record<Exclude<AppLocale, "en">, () => Promise<Record<string, Messages>>> = {
  zh: () => import("./zh.js"),
  es: () => import("./es.js"),
  fr: () => import("./fr.js"),
  ar: () => import("./ar.js"),
  ru: () => import("./ru.js"),
  de: () => import("./de.js"),
  ja: () => import("./ja.js"),
  ko: () => import("./ko.js"),
};

/** Explicitly load a locale's dictionary (idempotent). */
export async function loadLocale(lang: AppLocale): Promise<void> {
  if (lang === "en") return;
  const mod = await loaders[lang]();
  addMessages(lang, mod[lang]);
}

let initialized = false;

export function initI18n(): void {
  if (initialized) return;
  // en is always available synchronously (fallback + first-paint safety).
  addMessages("en", en);
  // Other locales register async loaders; svelte-i18n fetches them on demand.
  for (const lang of locales) {
    if (lang === "en") continue;
    register(lang, () => loaders[lang]().then((m) => m[lang]));
  }
  const initialLocale = readInitialLocale();
  const result = init({ fallbackLocale: defaultLocale, initialLocale });
  // init may be sync (void) or async (Promise) depending on loader timing.
  void Promise.resolve(result).then(async () => {
    // If the user's saved locale isn't en, wait for its chunk before the first
    // render resolves so translated strings appear without an English flash.
    if (initialLocale !== defaultLocale) {
      try {
        await waitLocale(initialLocale);
      } catch {
        // loader failure → fall back to en silently
      }
    }
    applyDocumentLocale(initialLocale);
  });
  applyDocumentLocale(initialLocale);
  initialized = true;
}

export function setAppLocale(value: AppLocale): void {
  if (browser) localStorage.setItem(localeStorageKey, value);
  // Switch immediately; svelte-i18n resolves the registered async loader for
  // this locale and flips `$isLoading` while it streams in. en stays as the
  // fallback so no blank strings flash during the (typically cached) fetch.
  void locale.set(value);
  applyDocumentLocale(value);
}

function applyDocumentLocale(value: AppLocale): void {
  if (!browser) return;
  document.documentElement.dir = value === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = value;
}

function readInitialLocale(): AppLocale {
  if (!browser) return defaultLocale;
  const saved = localStorage.getItem(localeStorageKey);
  return isAppLocale(saved) ? saved : defaultLocale;
}

function isAppLocale(value: string | null): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value);
}
