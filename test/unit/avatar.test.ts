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
import { avatarCachePath, fetchAndCacheAvatar } from '../../src/daemon/avatar.js';
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
  it('Scenario: Given profile JSON without a string avatar, When fetching, Then no image fetch is attempted', async () => {
    const calls = stubFetch([
      new Response(JSON.stringify({ avatar: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ]);

    await expect(fetchAndCacheAvatar('alice', 'https://registry.test/')).resolves.toBeNull();

    expect(calls.map((call) => String(call.input))).toEqual(['https://registry.test/-/user/alice']);
    await expect(fsp.access(avatarCachePath('alice'))).rejects.toBeTruthy();
  });

  it('Scenario: Given profile JSON with an avatar URL, When fetching, Then the image bytes are cached', async () => {
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
