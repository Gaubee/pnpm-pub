import type {
  PubEvent,
  TrustedPublisherConfig,
  TrustedPublisherCreateConfig,
  TrustedPublisherPermission,
  TrustedPublisherType,
} from "./types.js";

export function trustedPublisherSummary(config: TrustedPublisherConfig | null | undefined): string {
  if (!config) return "No trusted publishing configured";
  if (config.type === "github") {
    return [
      "GitHub",
      config.claims.repository,
      config.claims.workflow_ref.file,
      config.claims.environment,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (config.type === "gitlab") {
    return [
      "GitLab",
      config.claims.project_path,
      config.claims.ci_config_ref_uri,
      config.claims.environment,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    "CircleCI",
    config.claims["oidc.circleci.com/vcs-origin"],
    config.claims["oidc.circleci.com/project-id"],
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Shared trusted-publisher field metadata.
//
// The edit form (TrustedPublishingDraftForm) and the read-only display
// (TrustedPublishingReadonly) MUST agree on which fields each provider exposes,
// their labels, and their help text. Centralizing the descriptors here keeps
// the two surfaces from drifting. The form additionally needs placeholders,
// so `placeholderKey` / `placeholder` are optional extensions the form reads
// and the readonly component ignores.
// ---------------------------------------------------------------------------

/** Canonical field ids used to index a normalized value map. */
export type TrustedPublishingFieldKey =
  | "repoOwner"
  | "repoName"
  | "workflowFile"
  | "ciFilePath"
  | "environment"
  | "orgId"
  | "circleProjectId"
  | "pipelineDefinitionId"
  | "contextIds"
  | "vcsOrigin";

export interface TrustedPublishingFieldDescriptor {
  /** Stable id (used as a render key). */
  id: string;
  key: TrustedPublishingFieldKey;
  /** i18n key for the field's label. */
  labelKey: string;
  /** i18n key for the field's help/description text. */
  helpKey?: string;
  /** i18n key for an input placeholder (form-only). */
  placeholderKey?: string;
  /** Literal placeholder (form-only). */
  placeholder?: string;
}

/** Per-provider ordered field list. Shared by the form and the readonly view. */
export const TRUSTED_PUBLISHING_FIELDS: Record<
  TrustedPublisherType,
  readonly TrustedPublishingFieldDescriptor[]
> = {
  github: [
    { id: "owner", key: "repoOwner", labelKey: "trustedPublishing.repositoryOwner" },
    { id: "repo", key: "repoName", labelKey: "trustedPublishing.repositoryName" },
    {
      id: "workflow",
      key: "workflowFile",
      labelKey: "trustedPublishing.workflowFilename",
      helpKey: "trustedPublishing.workflowFileHelp",
      placeholderKey: "trustedPublishing.workflowFilePlaceholder",
    },
    {
      id: "environment",
      key: "environment",
      labelKey: "trustedPublishing.environment",
      helpKey: "trustedPublishing.environmentHelp",
    },
  ],
  gitlab: [
    { id: "namespace", key: "repoOwner", labelKey: "trustedPublishing.namespace" },
    { id: "project", key: "repoName", labelKey: "trustedPublishing.projectName" },
    {
      id: "ci",
      key: "ciFilePath",
      labelKey: "trustedPublishing.ciFilePath",
      helpKey: "trustedPublishing.ciFilePathHelp",
      placeholderKey: "trustedPublishing.ciFilePathPlaceholder",
    },
    {
      id: "environment",
      key: "environment",
      labelKey: "trustedPublishing.environment",
      helpKey: "trustedPublishing.environmentHelp",
    },
  ],
  circleci: [
    {
      id: "org",
      key: "orgId",
      labelKey: "trustedPublishing.orgId",
      helpKey: "trustedPublishing.orgIdHelp",
    },
    {
      id: "project-id",
      key: "circleProjectId",
      labelKey: "trustedPublishing.projectId",
      helpKey: "trustedPublishing.projectIdHelp",
    },
    {
      id: "pipeline",
      key: "pipelineDefinitionId",
      labelKey: "trustedPublishing.pipelineDefinitionId",
      helpKey: "trustedPublishing.pipelineDefHelp",
    },
    {
      id: "vcs",
      key: "vcsOrigin",
      labelKey: "trustedPublishing.vcsOrigin",
      helpKey: "trustedPublishing.vcsOriginHelp",
      placeholder: "github.com/owner/repo",
    },
    {
      id: "contexts",
      key: "contextIds",
      labelKey: "trustedPublishing.contextIds",
      helpKey: "trustedPublishing.contextIdsHelp",
      placeholderKey: "trustedPublishing.contextIdsPlaceholder",
    },
  ],
};

/** i18n key for a provider's display name. */
export function providerLabelKey(type: TrustedPublisherType): string {
  switch (type) {
    case "github":
      return "trustedPublishing.providerGithub";
    case "circleci":
      return "trustedPublishing.providerCircleci";
    case "gitlab":
      return "trustedPublishing.providerGitlab";
  }
}

/** An empty normalized value map (every field present, blank). */
function emptyTrustedPublishingValues(): Record<TrustedPublishingFieldKey, string> {
  return {
    repoOwner: "",
    repoName: "",
    workflowFile: "",
    ciFilePath: "",
    environment: "",
    orgId: "",
    circleProjectId: "",
    pipelineDefinitionId: "",
    contextIds: "",
    vcsOrigin: "",
  };
}

/**
 * Normalize any trusted-publisher config's claims into a flat
 * `{ fieldKey: value }` map keyed by {@link TrustedPublishingFieldKey}, so the
 * form and the readonly view can render generically over
 * {@link TRUSTED_PUBLISHING_FIELDS}. The inverse of the form's build step.
 */
export function extractTrustedPublishingValues(
  config: TrustedPublisherConfig | TrustedPublisherCreateConfig,
): Record<TrustedPublishingFieldKey, string> {
  const values = emptyTrustedPublishingValues();
  if (config.type === "github") {
    const [owner, ...rest] = config.claims.repository.split("/");
    values.repoOwner = owner ?? "";
    values.repoName = rest.join("/");
    values.workflowFile = config.claims.workflow_ref.file;
    values.environment = config.claims.environment ?? "";
  } else if (config.type === "gitlab") {
    const [owner, ...rest] = config.claims.project_path.split("/");
    values.repoOwner = owner ?? "";
    values.repoName = rest.join("/");
    values.ciFilePath = config.claims.ci_config_ref_uri ?? "";
    values.environment = config.claims.environment ?? "";
  } else {
    values.orgId = config.claims["oidc.circleci.com/org-id"];
    values.circleProjectId = config.claims["oidc.circleci.com/project-id"];
    values.pipelineDefinitionId = config.claims["oidc.circleci.com/pipeline-definition-id"];
    values.contextIds = (config.claims["oidc.circleci.com/context-ids"] ?? []).join(", ");
    values.vcsOrigin = config.claims["oidc.circleci.com/vcs-origin"];
  }
  return values;
}

export function providerFromHint(repositoryHint: string): TrustedPublisherType {
  const hint = repositoryHint.toLowerCase();
  if (hint.includes("gitlab.com") || hint.startsWith("gl:")) return "gitlab";
  if (hint.includes("circleci")) return "circleci";
  return "github";
}

export function splitRepositoryHint(repositoryHint: string): { owner: string; name: string } {
  const hint = repositoryHint.trim();
  if (!hint) return { owner: "", name: "" };
  const match = hint.match(/(?:github\.com|gitlab\.com)[:/](.+?)(?:\.git)?$/i);
  const path = match?.[1]
    ? match[1].replace(/^\/+/, "")
    : /^[\w.-]+\/[\w.-]+$/.test(hint)
      ? hint
      : "";
  const slash = path.indexOf("/");
  if (slash < 0) return { owner: path, name: "" };
  return { owner: path.slice(0, slash), name: path.slice(slash + 1) };
}

export function permissionsFromBooleans(
  allowPublish: boolean,
  allowStagePublish: boolean,
): TrustedPublisherPermission[] {
  const permissions: TrustedPublisherPermission[] = [];
  if (allowPublish) permissions.push("createPackage");
  if (allowStagePublish) permissions.push("createStagedPackage");
  return permissions;
}

export function configPermissions(
  config: TrustedPublisherConfig | TrustedPublisherCreateConfig | undefined,
): {
  allowPublish: boolean;
  allowStagePublish: boolean;
} {
  const permissions = config?.permissions ?? ["createPackage", "createStagedPackage"];
  return {
    allowPublish: permissions.includes("createPackage"),
    allowStagePublish: permissions.includes("createStagedPackage"),
  };
}

/**
 * Whether a DESIRED config (a `TrustedPublisherCreateConfig`, e.g. the group
 * default or a custom edit) is EFFECTIVELY EQUAL to an EXISTING config (a
 * `TrustedPublisherConfig` fetched from the registry, which carries an `id`).
 * Used for skip/conflict detection: equal ⇒ skip (no HTTP), different ⇒
 * conflict (user must resolve via custom).
 *
 * Comparison ignores the registry-assigned `id` (extractTrustedPublishingValues
 * flattens it away) and normalizes CircleCI `context-ids` (array ↔ comma-joined
 * string). `permissions` defaults to both-true when absent.
 */
export function trustedPublisherConfigsEqual(
  desired: TrustedPublisherCreateConfig,
  existing: TrustedPublisherConfig,
): boolean {
  if (desired.type !== existing.type) return false;
  const dp = configPermissions(desired);
  const ep = configPermissions(existing);
  if (dp.allowPublish !== ep.allowPublish || dp.allowStagePublish !== ep.allowStagePublish) {
    return false;
  }
  const dv = extractTrustedPublishingValues(desired);
  const ev = extractTrustedPublishingValues(existing);
  for (const key of Object.keys(dv) as TrustedPublishingFieldKey[]) {
    if ((dv[key] ?? "").trim() !== (ev[key] ?? "").trim()) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Group inheritance resolution (Chapter 6.2.5).
//
// Inheritance is an EXPLICIT flag owned by the daemon
// (`groupInheritMembers`). It is NOT inferred from whether a member's
// `payload.data.config` is empty — that would couple two concerns. A member
// either:
//   - inherits  → resolves to the group's shared default config; OR
//   - is custom → uses its own `payload.data.config`.
// The group default itself is stored ONCE (`groupTrustDefaults`); editing it
// never fans out into member payloads, which is what keeps the default form
// cheap to type in (no N×echo, no 100% CPU loop).
// ---------------------------------------------------------------------------

/**
 * Whether a configure-trust event currently INHERITS its group's default config
 * (vs. carrying its own custom config). Mirrors the daemon-side explicit flag.
 */
export function isMemberInheriting(
  event: PubEvent,
  groupInheritMembers: Record<string, string[]>,
): boolean {
  const groupId = event.groupId;
  if (!groupId) return false;
  if (event.payload?.kind !== "configure-trust") return false;
  if (event.payload.data.action === "remove") return false;
  return groupInheritMembers[groupId]?.includes(event.id) ?? false;
}

/**
 * Resolve the EFFECTIVE trusted-publishing config for a configure-trust event,
 * applying the inheritance rule: inherit → group default; custom → the event's
 * own config. Returns undefined when neither applies (not yet configured).
 */
export function resolveTrustedPublishingConfig(
  event: PubEvent,
  groupTrustDefaults: Record<string, TrustedPublisherCreateConfig>,
  groupInheritMembers: Record<string, string[]>,
): TrustedPublisherCreateConfig | undefined {
  if (event.payload?.kind !== "configure-trust") return undefined;
  const ctx = event.payload.data;
  if (ctx.action === "remove") return undefined;
  if (isMemberInheriting(event, groupInheritMembers)) {
    return event.groupId ? groupTrustDefaults[event.groupId] : undefined;
  }
  return ctx.config;
}
