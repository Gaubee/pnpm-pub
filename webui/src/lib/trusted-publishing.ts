import type {
  TrustedPublisherConfig,
  TrustedPublisherCreateConfig,
  TrustedPublisherPermission,
  TrustedPublisherType,
} from './types.js';

export function trustedPublisherSummary(config: TrustedPublisherConfig | null | undefined): string {
  if (!config) return 'No trusted publishing configured';
  if (config.type === 'github') {
    return ['GitHub', config.claims.repository, config.claims.workflow_ref.file, config.claims.environment]
      .filter(Boolean)
      .join(' · ');
  }
  if (config.type === 'gitlab') {
    return ['GitLab', config.claims.project_path, config.claims.ci_config_ref_uri, config.claims.environment]
      .filter(Boolean)
      .join(' · ');
  }
  return [
    'CircleCI',
    config.claims['oidc.circleci.com/vcs-origin'],
    config.claims['oidc.circleci.com/project-id'],
  ]
    .filter(Boolean)
    .join(' · ');
}

export function providerFromHint(repositoryHint: string): TrustedPublisherType {
  const hint = repositoryHint.toLowerCase();
  if (hint.includes('gitlab.com') || hint.startsWith('gl:')) return 'gitlab';
  if (hint.includes('circleci')) return 'circleci';
  return 'github';
}

export function splitRepositoryHint(repositoryHint: string): { owner: string; name: string } {
  const hint = repositoryHint.trim();
  if (!hint) return { owner: '', name: '' };
  const match = hint.match(/(?:github\.com|gitlab\.com)[:/](.+?)(?:\.git)?$/i);
  const path = match?.[1]
    ? match[1].replace(/^\/+/, '')
    : /^[\w.-]+\/[\w.-]+$/.test(hint)
      ? hint
      : '';
  const slash = path.indexOf('/');
  if (slash < 0) return { owner: path, name: '' };
  return { owner: path.slice(0, slash), name: path.slice(slash + 1) };
}

export function permissionsFromBooleans(
  allowPublish: boolean,
  allowStagePublish: boolean,
): TrustedPublisherPermission[] {
  const permissions: TrustedPublisherPermission[] = [];
  if (allowPublish) permissions.push('createPackage');
  if (allowStagePublish) permissions.push('createStagedPackage');
  return permissions;
}

export function configPermissions(config: TrustedPublisherConfig | TrustedPublisherCreateConfig | undefined): {
  allowPublish: boolean;
  allowStagePublish: boolean;
} {
  const permissions = config?.permissions ?? ['createPackage', 'createStagedPackage'];
  return {
    allowPublish: permissions.includes('createPackage'),
    allowStagePublish: permissions.includes('createStagedPackage'),
  };
}
