/**
 * Dotted keys whose value is INTENTIONALLY the same across all locales (brand
 * names, technical terms, literal placeholders). i18n-check.mjs skips these
 * when detecting "untranslated" (value === en), so they don't generate noise.
 *
 * Keep this list curated: only add a key if its en value is a proper noun /
 * product name / CLI token / file path / placeholder that must NOT be
 * translated into any language.
 */
export const intentionallyUntranslated = new Set([
  // Product / brand names.
  "common.appName",
  "settings.aboutGithub",
  "settings.aboutNpm",
  "profile.title", // "{username} · pnpm-pub"
  // Provider / service names (do not translate).
  "profile.github",
  "profile.twitter",
  "profile.npmToken",
  "profile.reauthManualTokenPlaceholder", // "npm_..."
  "packageDetail.readme", // "README"
  "trustedPublishing.providerGithub", // "GitHub Actions"
  "trustedPublishing.providerCircleci", // "CircleCI"
  "trustedPublishing.providerGitlab", // "GitLab CI"
  "trustedPublishing.workflowTab", // "Workflow"
  "eventCard.confirm", // "Confirm"
  // Literal placeholders / examples (kept verbatim in every locale).
  "events.packageScopePlaceholder", // "@scope/pkg"
  "events.repositoryPlaceholder", // "owner/repo"
  "events.packagePathPlaceholder", // "/path/to/package"
  "eventCard.tagPlaceholder", // "latest"
  "backup.bundlePlaceholder", // the JSON literal example
  "trustedPublishing.contextIdsPlaceholder", // "uuid, uuid, …"
  // Short technical labels that read better untranslated.
  "profile.idLabel", // "id"
  // "Trusted Publishing" / "Trusted Publish" — a proper feature name (npm/GitHub
  // OIDC terminology); kept verbatim in every locale, like a product name.
  "events.trustedPublish", // "Trusted Publish"
  "packageDetail.trustedPublishing", // "Trusted Publishing"
  "workspaces.trustedPublishing", // "Trusted Publishing"
  "trustedPublishing.title", // "Trusted Publishing"
  "groupEvent.kindTrustedPublishing", // "Trusted Publishing · {count}"
  "groupEvent.kindRemoveTrustedPublishing", // "Remove Trusted Publishing · {count}"
  "removeTrustedPublishingGroup.title", // "Remove Trusted Publishing"
  "trustedPublishing.oidcTitle", // "OIDC"
  "trustedPublishing.recursiveTitle", // "Recursive OIDC"
  "trustedPublishing.removeTrustedPublishing", // "Remove Trusted Publishing"
  // Structured interpolation templates (no translatable prose — just
  // placeholders + separators, identical and correct in every locale).
  "trustedPublishing.singleSubtitle", // "{name} · {path}"
  // "2FA" — universal abbreviation, kept verbatim.
  "profile.twoFactor", // "2FA"
  // Universally-borrowed technical UI labels (kept verbatim — these are common
  // loanwords / abbreviations in every supported locale, including CJK).
  "addProfile.registry", // "Registry"
  "profile.registry", // "Registry"
  "profile.email", // "Email"
  "profile.homepage", // "Homepage"
  "packageDetail.repository", // "Repository"
  "packageDetail.homepage", // "Homepage"
  "trustedPublishing.repositoryName", // "Repository"
  "trustedPublishing.namespace", // "Namespace"
  "settings.modeSystem", // "System"
  "eventCard.accessPublic", // "Public"
  "eventCard.tag", // "Tag"
  "packages.sortName", // "Name"
  "common.download", // "Download"
  // Coincidentally-identical short words across locales (same spelling is the
  // correct translation — e.g. Spanish "no" === English "no").
  "common.no", // "no"
  "common.optional", // "optional"
  "trustedPublishing.formModeCompact", // "Compact"
  "settings.general", // "General"
  // "AutoRenew" / "Batch" — product-feature nouns kept verbatim.
  "profile.autoRenew", // "AutoRenew"
  "workspaces.batch", // "Batch"
  "groupEvent.kindMixed", // "Batch · {count}"
]);
