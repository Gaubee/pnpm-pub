// Dynamic package route: the package name is runtime data (and may be scoped,
// containing `/`), never crawlable at build time. Disable prerender for this
// leaf (the SPA root +layout.ts sets prerender=true, which would otherwise
// mark this as prerenderable-but-missing and fail the build). SSR stays off
// (inherited).
export const prerender = false;
