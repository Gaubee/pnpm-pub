/**
 * Backwards-compat shim: re-exports the locale API from `src/locales/index.ts`.
 *
 * The implementation (locale dictionaries, on-demand loaders, init) now lives
 * in `src/locales/` so each non-en locale can be code-split. Existing imports
 * of `$lib/i18n.js` (initI18n / setAppLocale / locales / localeNames /
 * AppLocale) keep working unchanged — no call-site edits needed.
 *
 * New code can import directly from `$lib/locales/index.js`.
 */
export {
  initI18n,
  setAppLocale,
  loadLocale,
  locales,
  localeNames,
  type AppLocale,
  type Messages,
} from "../locales/index.js";
