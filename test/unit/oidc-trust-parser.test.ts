/**
 * Tests for parseTrustedPublisher — the daemon-side parser for npm's
 * /-/package/<name>/trust response configs.
 *
 * Verifies the schema validated against the real npm API response:
 *   config = { id, type, claims:{ repository, environment?, ... }, permissions:[] }
 * environment lives INSIDE claims (not at config top level).
 * permissions is required (defaults to createPackage+createStagedPackage when absent).
 */
import { describe, it, expect } from 'vitest';
import { parseTrustedPublisher } from '../../src/daemon/oidc-trust.js';

describe('parseTrustedPublisher', () => {
  // The actual npm response shape for opentray (GitHub Actions):
  const realGithubConfig = {
    id: '224c242b-a342-4023-8f06-c3ec428e5e72',
    type: 'github',
    claims: {
      repository: 'jixoai/opentray',
      workflow_ref: { file: 'release.yml' },
      environment: 'npm-release',
    },
    permissions: ['createPackage', 'createStagedPackage'],
    createdAt: '2026-05-31T08:10:06.928Z',
  };

  it('parses a real npm github config (environment in claims)', () => {
    const parsed = parseTrustedPublisher(realGithubConfig);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('github');
    expect(parsed!.id).toBe('224c242b-a342-4023-8f06-c3ec428e5e72');
    expect(parsed!.claims.repository).toBe('jixoai/opentray');
    expect(parsed!.claims.workflow_ref.file).toBe('release.yml');
    expect(parsed!.claims.environment).toBe('npm-release');
    expect(parsed!.permissions).toEqual(['createPackage', 'createStagedPackage']);
  });

  it('ignores extra fields like createdAt', () => {
    const parsed = parseTrustedPublisher(realGithubConfig);
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, unknown>).createdAt).toBeUndefined();
  });

  it('parses github config without environment', () => {
    const parsed = parseTrustedPublisher({
      type: 'github',
      claims: { repository: 'owner/repo', workflow_ref: { file: 'publish.yml' } },
      permissions: ['createPackage'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('github');
    expect(parsed!.claims.environment).toBeUndefined();
  });

  it('parses circleci config', () => {
    const parsed = parseTrustedPublisher({
      type: 'circleci',
      claims: { repository: 'owner/repo', context: 'release', environment: 'prod' },
      permissions: ['createPackage', 'createStagedPackage'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('circleci');
    expect(parsed!.claims.repository).toBe('owner/repo');
    expect(parsed!.claims.context).toBe('release');
    expect(parsed!.claims.environment).toBe('prod');
  });

  it('parses gitlab config', () => {
    const parsed = parseTrustedPublisher({
      type: 'gitlab',
      claims: { project: 'group/proj', ref: 'main', environment: 'ci' },
      permissions: ['createPackage'],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('gitlab');
    expect(parsed!.claims.project).toBe('group/proj');
    expect(parsed!.claims.ref).toBe('main');
    expect(parsed!.claims.environment).toBe('ci');
  });

  it('defaults permissions to createPackage+createStagedPackage when absent', () => {
    const parsed = parseTrustedPublisher({
      type: 'github',
      claims: { repository: 'owner/repo', workflow_ref: { file: 'publish.yml' } },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.permissions).toEqual(['createPackage', 'createStagedPackage']);
  });

  it('rejects null', () => {
    expect(parseTrustedPublisher(null)).toBeNull();
  });

  it('rejects unknown provider type', () => {
    expect(parseTrustedPublisher({ type: 'jenkins', claims: {}, permissions: [] })).toBeNull();
  });

  it('rejects github without repository', () => {
    expect(parseTrustedPublisher({ type: 'github', claims: { workflow_ref: { file: 'x' } }, permissions: [] })).toBeNull();
  });

  it('rejects github without workflow_ref.file', () => {
    expect(parseTrustedPublisher({ type: 'github', claims: { repository: 'o/r' }, permissions: [] })).toBeNull();
  });

  it('rejects circleci without repository', () => {
    expect(parseTrustedPublisher({ type: 'circleci', claims: { context: 'x' }, permissions: [] })).toBeNull();
  });

  it('rejects gitlab without project', () => {
    expect(parseTrustedPublisher({ type: 'gitlab', claims: { ref: 'main' }, permissions: [] })).toBeNull();
  });

  it('does NOT read environment from config top level (only claims)', () => {
    // environment at top level should be ignored; claims.environment is the source.
    const parsed = parseTrustedPublisher({
      type: 'github',
      claims: { repository: 'o/r', workflow_ref: { file: 'f.yml' } },
      permissions: [],
      environment: 'should-be-ignored',
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.claims.environment).toBeUndefined();
  });
});
