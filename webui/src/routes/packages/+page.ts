// The Packages list depends on the active profile (runtime data) and fetches
// from the live npm registry, so it is never prerenderable. SSR stays off
// (inherited from the SPA root +layout.ts).
export const prerender = false;
