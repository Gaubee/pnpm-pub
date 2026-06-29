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
import { avatarCachePath, fetchAndCacheAvatar, lookupNpmProfileIdentity } from '../../src/daemon/avatar.js';
import { setHomeOverride } from '../../src/shared/paths.js';

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
    const imageBytes = Buffer.from('png bytes');
    const calls = stubFetch([
      new Response(JSON.stringify({ avatar: 'https://img.test/alice.png' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
      new Response(imageBytes, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    ]);

    await expect(fetchAndCacheAvatar('alice', 'https://registry.test/')).resolves.toBe(avatarCachePath('alice'));

    expect(calls.map((call) => String(call.input))).toEqual([
      'https://registry.test/-/user/alice',
      'https://img.test/alice.png',
    ]);
    await expect(fsp.readFile(avatarCachePath('alice'))).resolves.toEqual(imageBytes);
  });
});

describe('lookupNpmProfileIdentity', () => {
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
