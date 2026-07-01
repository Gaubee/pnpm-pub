/**
 * Tests for unpublishVersion — the daemon-side thin wrapper over the SDK's
 * `unpublishPackage`.
 *
 * The revision-doc protocol (GET _rev → PUT packument → GET fresh _rev →
 * DELETE tarball) now lives inside safe-npm-sdk's `unpublishPackage`
 * (shipped in d02c2d1). This wrapper only derives the OTP from the profile
 * secret, builds a one-shot client, calls the SDK, and maps the result shape
 * ({ packageRemoved } → { wholePackageRemoved }). These tests verify that
 * delegation + mapping without re-testing the SDK internals.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the SDK surface the wrapper touches.
vi.mock('safe-npm-sdk', () => ({
  createClient: vi.fn(() => ({ __client: true })),
  publish: vi.fn(),
  buildPublishPackument: vi.fn(),
  unpublishPackage: vi.fn(),
}));

import { createClient, unpublishPackage as sdkUnpublish } from 'safe-npm-sdk';
import { unpublishVersion } from '../../src/daemon/npm-api.js';

const mockCreateClient = vi.mocked(createClient);
const mockSdkUnpublish = vi.mocked(sdkUnpublish);

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('unpublishVersion (SDK wrapper)', () => {
  it('delegates name + version + otp to the SDK and maps a single-version success', async () => {
    mockSdkUnpublish.mockResolvedValue({
      ok: true,
      data: { removedVersion: '1.0.0', packageRemoved: false, newRev: '2-def' },
      response: { status: 200, headers: new Map(), body: undefined },
    });

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org',
      token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.wholePackageRemoved).toBe(false);
    // SDK called with the right args + a derived OTP.
    expect(mockSdkUnpublish).toHaveBeenCalledWith('pkg', '1.0.0', expect.objectContaining({ otp: expect.any(String) }), expect.anything());
  });

  it('maps whole-package removal (packageRemoved → wholePackageRemoved)', async () => {
    mockSdkUnpublish.mockResolvedValue({
      ok: true,
      data: { removedVersion: '0.1.0', packageRemoved: true },
      response: { status: 200, headers: new Map(), body: undefined },
    });

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '0.1.0',
    });

    expect(result.ok).toBe(true);
    expect(result.wholePackageRemoved).toBe(true);
  });

  it('propagates an SDK failure (status + message)', async () => {
    mockSdkUnpublish.mockResolvedValue({
      ok: false,
      error: { status: 404, message: 'Not found', headers: new Map(), body: undefined },
      response: { status: 404, headers: new Map(), body: undefined },
    });

    const result = await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe('Not found');
  });

  it('passes an explicit one-shot OTP through instead of deriving from the secret', async () => {
    mockSdkUnpublish.mockResolvedValue({
      ok: true,
      data: { removedVersion: '1.0.0', packageRemoved: false },
      response: { status: 200, headers: new Map(), body: undefined },
    });

    await unpublishVersion({
      registry: 'https://registry.npmjs.org', token: 'tok', totpSecret: TOTP_SECRET,
      name: 'pkg', version: '1.0.0', otp: '987654',
    });

    expect(mockSdkUnpublish).toHaveBeenCalledWith('pkg', '1.0.0', expect.objectContaining({ otp: '987654' }), expect.anything());
  });

  it('builds the client with the token + registry', async () => {
    mockSdkUnpublish.mockResolvedValue({
      ok: true,
      data: { removedVersion: '1.0.0', packageRemoved: false },
      response: { status: 200, headers: new Map(), body: undefined },
    });

    await unpublishVersion({
      registry: 'https://registry.example.test/', token: 'my-token', totpSecret: TOTP_SECRET,
      name: '@scope/pkg', version: '1.0.0',
    });

    expect(mockCreateClient).toHaveBeenCalledWith({ auth: { token: 'my-token' }, registry: 'https://registry.example.test/' });
  });
});
