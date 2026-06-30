/**
 * Avatar cache tests (Chapter 4.3).
 *
 * The NPM profile response is an external projection source. Keep it as
 * unknown until a local guard proves the `avatar` field is a usable URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  avatarCachePath,
  fetchAndCacheAvatar,
  hasCachedAvatar,
  lookupNpmProfileIdentity,
  trayIconForProfile,
} from '../../src/daemon/avatar.js';
import { setHomeOverride } from '../../src/shared/paths.js';

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const npmProfileMocks = vi.hoisted(() => ({
  readAuthenticatedProfile: vi.fn(),
}));

vi.mock('../../src/daemon/npm-profile-client.js', () => ({
  readAuthenticatedProfile: npmProfileMocks.readAuthenticatedProfile,
}));

const sandbox = path.join(os.tmpdir(), `pnpm-pub-avatar-${process.pid}-${Date.now()}`);

interface FetchCall {
  input: string | URL | Request;
  init?: RequestInit;
}

function stubFetch(responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected fetch call');
    }
    return response;
  };
  vi.stubGlobal('fetch', fetchImpl);
  return calls;
}

beforeEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true });
  await fsp.mkdir(sandbox, { recursive: true });
  setHomeOverride(sandbox);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setHomeOverride(null);
  await fsp.rm(sandbox, { recursive: true, force: true });
});

describe('fetchAndCacheAvatar', () => {
  it('Scenario: Given npm exposes no verified avatar, When fetching, Then no image fetch is attempted', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ objects: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);

    await expect(fetchAndCacheAvatar('alice', 'https://registry.test/')).resolves.toBeNull();

    expect(calls.map((call) => String(call.input))).toEqual([
      'https://registry.test/-/user/alice',
      'https://registry.test/-/user/org.couchdb.user:alice',
      'https://registry.test/-/v1/search?text=maintainer%3Aalice&size=5',
    ]);
    await expect(fsp.access(avatarCachePath('alice'))).rejects.toBeTruthy();
  });

  it('Scenario: Given registry profile JSON with an avatar URL, When fetching, Then the image bytes are cached', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ avatar: 'https://img.test/alice.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(pngBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ]);

    await expect(fetchAndCacheAvatar('alice', 'https://registry.test/')).resolves.toBe(avatarCachePath('alice'));

    expect(calls.map((call) => String(call.input))).toEqual([
      'https://registry.test/-/user/alice',
      'https://img.test/alice.png',
    ]);
    await expect(fsp.readFile(avatarCachePath('alice'))).resolves.toEqual(pngBytes);
  });

  it('Scenario: Given an avatar URL returns JPEG bytes, When fetching for tray cache, Then it is not cached as PNG', async () => {
    stubFetch([
      new Response(JSON.stringify({ avatar: 'https://img.test/alice.jpg' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(jpegBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    ]);

    await expect(fetchAndCacheAvatar('alice', 'https://registry.test/')).resolves.toBeNull();
    await expect(fsp.access(avatarCachePath('alice'))).rejects.toBeTruthy();
  });

  it('Scenario: Given a stale JPEG file in the PNG avatar cache, When resolving a tray icon, Then the stale file is removed', async () => {
    await fsp.mkdir(path.dirname(avatarCachePath('alice')), { recursive: true });
    await fsp.writeFile(avatarCachePath('alice'), jpegBytes);

    expect(hasCachedAvatar('alice')).toBe(false);
    expect(trayIconForProfile('alice')).toBeNull();
    await expect(fsp.access(avatarCachePath('alice'))).rejects.toBeTruthy();
  });
});

describe('lookupNpmProfileIdentity', () => {
  it('Scenario: Given authenticated profile lookup is rejected, When resolving, Then public avatar sources are still attempted', async () => {
    npmProfileMocks.readAuthenticatedProfile.mockRejectedValue(new Error('401 Unauthorized'));
    const calls = stubFetch([
      new Response(JSON.stringify({ avatar: 'https://img.test/alice.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);

    await expect(
      lookupNpmProfileIdentity('alice', 'https://registry.test/', {
        token: 'npm_token',
      }),
    ).resolves.toEqual({
      username: 'alice',
      registry: 'https://registry.test',
      avatarUrl: 'https://img.test/alice.png',
      source: 'registry-profile',
    });

    expect(npmProfileMocks.readAuthenticatedProfile).toHaveBeenCalledWith('npm_token', 'https://registry.test');
    expect(calls.map((call) => String(call.input))).toEqual([
      'https://registry.test/-/user/alice',
    ]);
  });

  it('Scenario: Given authenticated profile email and Gravatar exists, When resolving, Then the authenticated Gravatar wins', async () => {
    const calls = stubFetch([
      new Response(null, { status: 200 }),
    ]);

    await expect(
      lookupNpmProfileIdentity('alice', 'https://registry.test/', {
        profile: { email: 'alice@example.com', avatarUrl: null },
      }),
    ).resolves.toEqual({
      username: 'alice',
      registry: 'https://registry.test',
      avatarUrl: 'https://gravatar.com/avatar/c160f8cc69a4f0bf2b0362752353d060?s=128&d=404',
      source: 'authenticated-profile',
    });

    expect(calls.map((call) => String(call.input))).toEqual([
      'https://gravatar.com/avatar/c160f8cc69a4f0bf2b0362752353d060?s=128&d=404',
    ]);
    expect(calls[0]?.init?.method).toBe('HEAD');
  });

  it('Scenario: Given search finds maintainer email and Gravatar exists, When resolving, Then it returns a verified avatar URL', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ ok: false }), { status: 401, headers: { 'content-type': 'application/json' } }),
      new Response(
        JSON.stringify({
          objects: [
            {
              package: {
                maintainers: [{ username: 'alice', email: 'alice@example.com' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      new Response(null, { status: 200 }),
    ]);

    await expect(lookupNpmProfileIdentity('alice', 'https://registry.test/')).resolves.toEqual({
      username: 'alice',
      registry: 'https://registry.test',
      avatarUrl: 'https://gravatar.com/avatar/c160f8cc69a4f0bf2b0362752353d060?s=128&d=404',
      source: 'maintainer-gravatar',
    });

    expect(calls.map((call) => String(call.input))).toEqual([
      'https://registry.test/-/user/alice',
      'https://registry.test/-/user/org.couchdb.user:alice',
      'https://registry.test/-/v1/search?text=maintainer%3Aalice&size=5',
      'https://gravatar.com/avatar/c160f8cc69a4f0bf2b0362752353d060?s=128&d=404',
    ]);
    expect(calls[3]?.init?.method).toBe('HEAD');
  });
});
