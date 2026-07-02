/**
 * Tests for fetchPackageDetail — the daemon-side projection that fans out to
 * the registry packument, collaborators, and weekly downloads and merges them
 * into the UI-facing PackageDetail shape.
 *
 * The SDK client + collaborators op + global fetch are mocked so the test is
 * hermetic. Verifies: happy-path projection, scoped-name escaping, packument
 * 404, collaborators-failure graceful degradation, downloads-failure → 0.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  request: vi.fn(),
  getPackageCollaborators: vi.fn(),
}));

vi.mock('safe-npm-sdk', () => ({
  createClient: () => ({ request: sdkMocks.request }),
  escapePackageName: (name: string) => name.replace('/', '%2F'),
  getPackageCollaborators: sdkMocks.getPackageCollaborators,
}));

const fetchSpy = vi.spyOn(globalThis, 'fetch');

// Imported AFTER the mocks are registered.
const { fetchPackageDetail } = await import('../../src/daemon/npm-package-detail.js');

const AUTH = { registry: 'https://registry.npmjs.org/', token: 'tok' };

function packument(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: 'mypkg',
    'dist-tags': { latest: '2.1.0', old: '1.0.0' },
    time: {
      created: '2023-01-01T00:00:00.000Z',
      modified: '2024-05-01T00:00:00.000Z',
      '2.1.0': '2024-04-10T00:00:00.000Z',
      '1.0.0': '2023-06-01T00:00:00.000Z',
    },
    description: 'A nice package.',
    readme: '# My Pkg\n\nHello.',
    license: 'MIT',
    homepage: 'https://example.com',
    repository: { type: 'git', url: 'git+https://github.com/me/mypkg.git' },
    keywords: ['cli', 'tool'],
    maintainers: [{ name: 'me', email: 'me@example.com' }],
    ...overrides,
  };
}

afterEach(() => {
  sdkMocks.request.mockReset();
  sdkMocks.getPackageCollaborators.mockReset();
  fetchSpy.mockReset();
  vi.clearAllMocks();
});

describe('fetchPackageDetail', () => {
  it('projects packument + collaborators + downloads into PackageDetail', async () => {
    sdkMocks.request.mockResolvedValue({ ok: true, data: packument() });
    sdkMocks.getPackageCollaborators.mockResolvedValue({
      ok: true,
      data: { me: 'write', you: 'read' },
    });
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ downloads: 1234 }), { status: 200 }),
    );

    const res = await fetchPackageDetail('mypkg', AUTH);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.detail).toMatchObject({
      name: 'mypkg',
      version: '2.1.0',
      description: 'A nice package.',
      readme: '# My Pkg\n\nHello.',
      license: 'MIT',
      repository: 'git+https://github.com/me/mypkg.git',
      homepage: 'https://example.com',
      lastPublish: '2024-04-10T00:00:00.000Z',
      modified: '2024-05-01T00:00:00.000Z',
      keywords: ['cli', 'tool'],
      weeklyDownloads: 1234,
    });
    expect(res.detail.collaborators).toEqual([
      { username: 'me', access: 'write' },
      { username: 'you', access: 'read' },
    ]);
    // Packument path was escaped (scoped names especially).
    expect(sdkMocks.request.mock.calls[0]![0]).toMatchObject({ method: 'GET', path: '/mypkg' });
  });

  it('escapes scoped package names in the packument path', async () => {
    sdkMocks.request.mockResolvedValue({
      ok: true,
      data: packument({ name: '@scope/mypkg' }),
    });
    sdkMocks.getPackageCollaborators.mockResolvedValue({ ok: true, data: {} });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ downloads: 0 }), { status: 200 }));

    const res = await fetchPackageDetail('@scope/mypkg', AUTH);
    expect(res.ok).toBe(true);
    expect(sdkMocks.request.mock.calls[0]![0].path).toBe('/@scope%2Fmypkg');
  });

  it('returns 404 when the packument is not found', async () => {
    sdkMocks.request.mockResolvedValue({
      ok: false,
      error: { status: 404, message: 'not found' },
    });

    const res = await fetchPackageDetail('nope', AUTH);
    expect(res).toEqual({ ok: false, status: 404, error: 'not found' });
    // No downstream calls should fire for a missing packument.
    expect(sdkMocks.getPackageCollaborators).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to packument maintainers when collaborators call fails', async () => {
    sdkMocks.request.mockResolvedValue({ ok: true, data: packument() });
    sdkMocks.getPackageCollaborators.mockResolvedValue({
      ok: false,
      error: { status: 401, message: 'no access' },
    });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ downloads: 7 }), { status: 200 }));

    const res = await fetchPackageDetail('collab-fallback-pkg', AUTH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.detail.collaborators).toEqual([{ username: 'me', email: 'me@example.com' }]);
    expect(res.detail.weeklyDownloads).toBe(7);
  });

  it('degrades to 0 weekly downloads when the downloads endpoint fails', async () => {
    sdkMocks.request.mockResolvedValue({ ok: true, data: packument() });
    sdkMocks.getPackageCollaborators.mockResolvedValue({ ok: true, data: {} });
    fetchSpy.mockResolvedValue(new Response('', { status: 500 }));

    const res = await fetchPackageDetail('downloads-fail-pkg', AUTH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.detail.weeklyDownloads).toBe(0);
  });

  it('rejects an empty package name with 400', async () => {
    const res = await fetchPackageDetail('   ', AUTH);
    expect(res).toEqual({ ok: false, status: 400, error: 'Invalid package name.' });
    expect(sdkMocks.request).not.toHaveBeenCalled();
  });
});
