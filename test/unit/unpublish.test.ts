/**
 * Tests for unpublishVersion — the daemon-side single-version removal that
 * drives npm's CouchDB revision-doc protocol via the SDK's low-level
 * client.request.
 *
 * Verifies the 5-step exchange (GET → PUT packument → GET fresh _rev →
 * DELETE tarball asset), dist-tags latest reassignment when the removed
 * version was latest, the whole-package DELETE branch when it was the only
 * version, and the no-op when the version is already absent.
 *
 * createClient is mocked so we can assert the exact request sequence
 * without touching the network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Record of every client.request call: collected by the mock client.
interface RecordedCall {
  method: string;
  path: string;
  body?: unknown;
  otp?: string;
}

/**
 * Build a mock SDK client whose `request` resolves scripted responses in
 * order, recording each invocation. This mirrors the SDK's
 * NpmClient.request signature closely enough for the daemon's usage.
 */
function mockClient(responses: Array<{ ok: boolean; status: number; data?: unknown; message?: string }>) {
  const calls: RecordedCall[] = [];
  let cursor = 0;
  return {
    calls,
    client: {
      registry: 'https://registry.npmjs.org',
      auth: { token: 'tok' },
      timeout: 30_000,
      retries: 0,
      request: async (opts: RecordedCall & { schema: unknown }) => {
        calls.push({ method: opts.method, path: opts.path, body: opts.body, otp: opts.otp });
        const scripted = responses[cursor];
        cursor += 1;
        if (!scripted) throw new Error(`unexpected extra request #${cursor}`);
        if (scripted.ok) {
          return { ok: true as const, data: scripted.data, response: { status: scripted.status, headers: new Map(), body: scripted.data } };
        }
        return { ok: false as const, error: { status: scripted.status, message: scripted.message ?? 'fail', headers: new Map(), body: undefined } };
      },
    },
  };
}

// Mock the SDK's createClient + escapePackageName so the daemon imports ours.
vi.mock('safe-npm-sdk', () => ({
  createClient: vi.fn(),
  escapePackageName: (name: string) => name.replace(/\//g, '%2F'),
  publish: vi.fn(),
}));

import { createClient } from 'safe-npm-sdk';
import { unpublishVersion } from '../../src/daemon/npm-api.js';

const mockCreateClient = vi.mocked(createClient);

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('unpublishVersion', () => {
  it('removes a single version: GET → PUT → GET → DELETE the tarball asset', async () => {
    const { calls, client } = mockClient([
      // 1. initial GET → packument with _rev, two versions, latest points at the other
      {
        ok: true, status: 200,
        data: {
          _id: 'pkg', _rev: '1-abc',
          'dist-tags': { latest: '1.1.0' },
          versions: {
            '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz' } },
            '1.1.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.1.0.tgz' } },
          },
          time: { '1.0.0': '2024-01-01', '1.1.0': '2024-02-01' },
        },
      },
      // 3. PUT → accepted
      { ok: true, status: 201, data: { ok: 'updated' } },
      // 4. second GET → fresh _rev
      { ok: true, status: 200, data: { _rev: '2-def', 'dist-tags': { latest: '1.1.0' }, versions: { '1.1.0': {} } } },
      // 5. DELETE tarball → ok
      { ok: true, status: 200, data: {} },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org',
      token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0',
    });

    expect(result.ok).toBe(true);
    expect(result.wholePackageRemoved).toBeUndefined();
    // Sequence: GET, PUT, GET, DELETE (4 calls)
    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/pkg' });
    expect(calls[1]).toMatchObject({ method: 'PUT', path: '/pkg/-rev/1-abc' });
    expect(calls[2]).toMatchObject({ method: 'GET', path: '/pkg' });
    expect(calls[3]).toMatchObject({ method: 'DELETE', path: '/pkg/-/pkg-1.0.0.tgz/-rev/2-def' });
    // PUT body has the version stripped and the other kept
    const putBody = calls[1]!.body as Record<string, unknown>;
    expect(putBody.versions).not.toHaveProperty('1.0.0');
    expect(putBody.versions).toHaveProperty('1.1.0');
    // latest untouched (it pointed at 1.1.0 already)
    expect(putBody['dist-tags']).toMatchObject({ latest: '1.1.0' });
    // _revisions / _attachments stripped
    expect(putBody._revisions).toBeUndefined();
  });

  it('reassigns latest when the removed version was latest', async () => {
    const { calls, client } = mockClient([
      {
        ok: true, status: 200,
        data: {
          _id: 'pkg', _rev: '1-abc',
          'dist-tags': { latest: '2.0.0' },
          versions: {
            '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz' } },
            '1.5.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.5.0.tgz' } },
            '2.0.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz' } },
          },
          time: {},
        },
      },
      { ok: true, status: 201, data: {} },
      { ok: true, status: 200, data: { _rev: '2-def', versions: {} } },
      { ok: true, status: 200, data: {} },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '2.0.0',
    });

    expect(result.ok).toBe(true);
    // latest reassigned to the greatest remaining (1.5.0)
    const putBody = calls[1]!.body as Record<string, unknown>;
    expect(putBody['dist-tags']).toMatchObject({ latest: '1.5.0' });
    expect(putBody.versions).not.toHaveProperty('2.0.0');
  });

  it('removes the whole package when the version was the only one', async () => {
    const { calls, client } = mockClient([
      {
        ok: true, status: 200,
        data: {
          _id: 'pkg', _rev: '1-abc',
          'dist-tags': { latest: '0.1.0' },
          versions: { '0.1.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-0.1.0.tgz' } } },
          time: {},
        },
      },
      // whole-package DELETE
      { ok: true, status: 200, data: {} },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '0.1.0',
    });

    expect(result.ok).toBe(true);
    expect(result.wholePackageRemoved).toBe(true);
    // Only 2 calls: initial GET, then whole-package DELETE
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/pkg' });
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/pkg/-rev/1-abc' });
  });

  it('is a no-op success when the version does not exist', async () => {
    const { calls, client } = mockClient([
      {
        ok: true, status: 200,
        data: {
          _id: 'pkg', _rev: '1-abc',
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { dist: { tarball: 'x' } } },
          time: {},
        },
      },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '9.9.9',
    });

    expect(result.ok).toBe(true);
    // Only the initial GET; no further writes.
    expect(calls).toHaveLength(1);
  });

  it('propagates a registry GET failure', async () => {
    const { calls, client } = mockClient([
      { ok: false, status: 404, message: 'Not found' },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe('Not found');
    expect(calls).toHaveLength(1);
  });

  it('escapes scoped package names in the path', async () => {
    const { calls, client } = mockClient([
      {
        ok: true, status: 200,
        data: {
          _id: '@scope/pkg', _rev: '1-abc',
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz' } } },
          time: {},
        },
      },
      { ok: true, status: 200, data: {} },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: '@scope/pkg', version: '1.0.0',
    });

    expect(result.ok).toBe(true);
    expect(result.wholePackageRemoved).toBe(true);
    // scoped name escaped in the path
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/@scope%2Fpkg' });
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/@scope%2Fpkg/-rev/1-abc' });
  });

  it('forwards the generated OTP on every request', async () => {
    const { calls, client } = mockClient([
      {
        ok: true, status: 200,
        data: {
          _id: 'pkg', _rev: '1-abc',
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz' } } },
          time: {},
        },
      },
      { ok: true, status: 200, data: {} },
    ]);
    mockCreateClient.mockReturnValue(client as never);

    await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0',
    });

    // Every request carries a non-empty otp (TOTP derived from the secret).
    for (const call of calls) {
      expect(typeof call.otp).toBe('string');
      expect(call.otp!.length).toBeGreaterThan(0);
    }
  });
});
