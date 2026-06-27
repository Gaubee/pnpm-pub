/**
 * Package version reader tests (Chapter 7.2.1).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { readPackageVersionFrom } from '../../src/shared/package-version.js';

const sandbox = path.join('/tmp', `pp-version-${process.pid}-${Date.now()}`);

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe('Feature: package version release truth', () => {
  it('Scenario: Given a nested runtime file, When reading package version, Then it resolves the pnpm-pub manifest version', async () => {
    const root = path.join(sandbox, 'repo');
    const nested = path.join(root, 'dist', 'shared');
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'pnpm-pub', version: '1.2.3' }));

    expect(readPackageVersionFrom(nested)).toBe('1.2.3');
  });

  it('Scenario: Given malformed child manifests, When walking upward, Then only decoded pnpm-pub metadata becomes release truth', async () => {
    const root = path.join(sandbox, 'repo');
    const nested = path.join(root, 'packages', 'tool', 'src');
    await fsp.mkdir(nested, { recursive: true });
    await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'pnpm-pub', version: '2.0.0' }));
    await fsp.writeFile(path.join(root, 'packages', 'tool', 'package.json'), '[]');

    expect(readPackageVersionFrom(nested)).toBe('2.0.0');
  });

  it('Scenario: Given pnpm-pub metadata without a string version, When reading package version, Then it fails closed', async () => {
    const root = path.join(sandbox, 'repo');
    await fsp.mkdir(root, { recursive: true });
    await fsp.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'pnpm-pub', version: 123 }));

    expect(() => readPackageVersionFrom(root)).toThrow('Invalid pnpm-pub package metadata');
  });
});
