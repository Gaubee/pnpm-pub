/**
 * Workspace scanner tests (Chapter 10.1.3).
 *
 * Exercises find-root, the pnpm-workspace.yaml priority path, the exclude
 * rules (node_modules / .git / private packages), and profile filtering.
 */
import { describe, it, expect } from 'vitest';
import { makeVolume, ROOT } from '../helpers/memfs-adapter.js';
import {
  findProjectRoot,
  isRiskyRoot,
  readWorkspacePackages,
  scanWorkspace,
  filterByProfile,
} from '../../src/daemon/workspace.js';

describe('findProjectRoot (Chapter 5.3.1)', () => {
  it('returns the directory containing pnpm-workspace.yaml first', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/monorepo/pnpm-workspace.yaml`, 'packages:\n  - packages/*');
    v.write(`${ROOT}/monorepo/packages/a/package.json`, '{"name":"a"}');
    const res = await findProjectRoot(`${ROOT}/monorepo/packages/a/src`, v.fs);
    expect(res.root).toBe(`${ROOT}/monorepo`);
    expect(res.matchedMarker).toBe('pnpm-workspace.yaml');
  });

  it('falls back to .git then package.json', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/repo/.git/HEAD`, 'ref: refs/heads/main');
    v.write(`${ROOT}/repo/package.json`, '{"name":"repo"}');
    const res = await findProjectRoot(`${ROOT}/repo/src/deep`, v.fs);
    expect(res.root).toBe(`${ROOT}/repo`);
    expect(res.matchedMarker).toBe('.git');
  });

  it('returns null when no marker exists up to fs root (risk case)', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/loose/deep/file.txt`, 'x');
    const res = await findProjectRoot(`${ROOT}/loose/deep`, v.fs);
    expect(res.root).toBeNull();
  });

  it('nested monorepo: pnpm-workspace.yaml wins over a nearer package.json', async () => {
    // Layout: monorepo/pnpm-workspace.yaml  (root)
    //         monorepo/packages/widget/package.json + .git
    // Scanning from widget/ should resolve to the workspace root, NOT the
    // nearer package.json/.git — that's the spec's priority rule (5.3.1).
    const v = makeVolume();
    v.write(`${ROOT}/mono/pnpm-workspace.yaml`, 'packages:\n  - "packages/*"');
    v.write(`${ROOT}/mono/package.json`, '{"name":"mono-root"}');
    v.write(`${ROOT}/mono/packages/widget/package.json`, '{"name":"widget"}');
    v.write(`${ROOT}/mono/packages/widget/.git/HEAD`, 'ref: refs/heads/main');
    const res = await findProjectRoot(`${ROOT}/mono/packages/widget/src/lib`, v.fs);
    expect(res.root).toBe(`${ROOT}/mono`);
    expect(res.matchedMarker).toBe('pnpm-workspace.yaml');
  });
});

describe('isRiskyRoot (Chapter 5.3.2)', () => {
  const fs = makeVolume().fs;
  it('flags the filesystem root', () => {
    expect(isRiskyRoot('/', fs)).toBe(true);
  });
  it('flags the home directory', () => {
    expect(isRiskyRoot('/home/test', fs)).toBe(true);
  });
  it('flags Downloads/Desktop/etc by name', () => {
    expect(isRiskyRoot('/Users/x/Downloads', fs)).toBe(true);
    expect(isRiskyRoot('/Users/x/Desktop', fs)).toBe(true);
  });
  it('does not flag a real project directory', () => {
    expect(isRiskyRoot(`${ROOT}/my-project`, fs)).toBe(false);
  });
});

describe('readWorkspacePackages', () => {
  it('parses packages from pnpm-workspace.yaml', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/p/pnpm-workspace.yaml`, "packages:\n  - 'packages/*'\n  - 'tools/*'\n");
    const globs = await readWorkspacePackages(`${ROOT}/p`, v.fs);
    expect(globs).toEqual(['packages/*', 'tools/*']);
  });

  it('returns null when the file is absent', async () => {
    const v = makeVolume();
    expect(await readWorkspacePackages(`${ROOT}/p`, v.fs)).toBeNull();
  });
});

describe('scanWorkspace (Chapter 5.3.4 / 6.3.1)', () => {
  it('uses pnpm-workspace.yaml globs to locate packages', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/ws/pnpm-workspace.yaml`, 'packages:\n  - "packages/*"');
    v.write(`${ROOT}/ws/packages/@scope/a/package.json`, '{"name":"@scope/a","version":"1.0.0"}');
    v.write(`${ROOT}/ws/packages/b/package.json`, '{"name":"b","version":"2.0.0"}');
    // A decoy that should NOT be picked up (not under packages/).
    v.write(`${ROOT}/ws/decoy/package.json`, '{"name":"decoy"}');
    const pkgs = await scanWorkspace(`${ROOT}/ws`, v.fs, { root: `${ROOT}/ws` });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toContain('@scope/a');
    expect(names).toContain('b');
    expect(names).not.toContain('decoy');
  });

  it('excludes node_modules, .git, and private packages', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/plain/package.json`, '{"name":"plain","version":"0.1.0"}');
    v.write(`${ROOT}/plain/src/lib/package.json`, '{"name":"lib","version":"0.2.0"}');
    // private — must be skipped
    v.write(`${ROOT}/plain/internal/package.json`, '{"name":"internal","private":true}');
    // inside node_modules — must be skipped
    v.write(`${ROOT}/plain/node_modules/dep/package.json`, '{"name":"dep"}');
    const pkgs = await scanWorkspace(`${ROOT}/plain`, v.fs, { root: `${ROOT}/plain` });
    const names = pkgs.map((p) => p.name).sort();
    expect(names).toEqual(['lib', 'plain']);
  });

  it('honors .gitignore entries at root', async () => {
    const v = makeVolume();
    v.write(`${ROOT}/gi/.gitignore`, 'build\ncoverage\n');
    v.write(`${ROOT}/gi/package.json`, '{"name":"gi","version":"1.0.0"}');
    v.write(`${ROOT}/gi/build/pkg/package.json`, '{"name":"built"}');
    v.write(`${ROOT}/gi/coverage/pkg/package.json`, '{"name":"cov"}');
    const pkgs = await scanWorkspace(`${ROOT}/gi`, v.fs, { root: `${ROOT}/gi`, respectGitignore: true });
    const names = pkgs.map((p) => p.name);
    expect(names).toContain('gi');
    expect(names).not.toContain('built');
    expect(names).not.toContain('cov');
  });
});

describe('filterByProfile (Chapter 5.3.5)', () => {
  const pkgs: ScannedPackage[] = [
    { name: '@org-admin/widget', version: '1.0.0', path: '/a' },
    { name: '@personal/blog', version: '2.0.0', path: '/b' },
    { name: 'unscoped-pkg', version: '3.0.0', path: '/c' },
    { name: '@org-admin/private-thing', version: '0.0.1', private: true, path: '/d' },
  ];

  it('returns scoped packages matching the profile username + all unscoped', () => {
    const out = filterByProfile(pkgs, 'org-admin').map((p) => p.name);
    expect(out).toContain('@org-admin/widget');
    expect(out).toContain('unscoped-pkg');
    expect(out).not.toContain('@personal/blog');
  });

  it('always drops private packages', () => {
    const out = filterByProfile(pkgs, 'org-admin').map((p) => p.name);
    expect(out).not.toContain('@org-admin/private-thing');
  });

  it('matches case-insensitively', () => {
    const out = filterByProfile(pkgs, 'ORG-ADMIN').map((p) => p.name);
    expect(out).toContain('@org-admin/widget');
  });
});
