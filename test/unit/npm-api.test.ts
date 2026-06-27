import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyToken, configureOidc, isExpiredToken, publishPackage } from '../../src/daemon/npm-api.js';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

afterEach(() => {
  fetchSpy.mockReset();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

describe('applyToken (Chapter 8.1)', () => {
  it('Scenario: Given credentials, When applying a token, Then it posts a burnable request body buffer', async () => {
    let capturedBody: BodyInit | null | undefined;
    fetchSpy.mockImplementation(async (_input, init) => {
      capturedBody = init?.body;
      return new Response(JSON.stringify({ token: 'npm_generated' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      applyToken({
        registry: 'https://registry.example.test/',
        username: 'alice',
        password: 'secret-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).resolves.toEqual({ ok: true, token: 'npm_generated' });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.example.test/-/npm/v1/tokens',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(Buffer.isBuffer(capturedBody)).toBe(true);
    if (!Buffer.isBuffer(capturedBody)) throw new Error('Expected burnable request body buffer');
    expect(Buffer.from(capturedBody).every((byte) => byte === 0)).toBe(true);
  });

  it('Scenario: Given a malformed success response, When applying a token, Then no token fact is accepted', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ token: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      applyToken({
        registry: 'https://registry.example.test/',
        username: 'alice',
        password: 'secret-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).resolves.toEqual({ ok: false, error: 'HTTP 200' });
  });

  it('Scenario: Given an empty token response, When applying a token, Then no credential fact is created', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ token: '   ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      applyToken({
        registry: 'https://registry.example.test/',
        username: 'alice',
        password: 'secret-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).resolves.toEqual({ ok: false, error: 'HTTP 200' });
  });

  it('Scenario: Given a CouchDB-style token rejection, When applying a token, Then error and reason are projected together', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ error: 'forbidden', reason: 'captcha required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      applyToken({
        registry: 'https://registry.example.test/',
        username: 'alice',
        password: 'secret-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).resolves.toEqual({
      ok: false,
      needsManualToken: true,
      error: 'forbidden: captcha required',
    });
  });

  it('Scenario: Given fetch rejects with a non-Error value, When applying a token, Then the failure is projected without casts', async () => {
    fetchSpy.mockImplementation(async () => {
      throw 'network unavailable';
    });

    await expect(
      applyToken({
        registry: 'https://registry.example.test/',
        username: 'alice',
        password: 'secret-password',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      }),
    ).resolves.toEqual({ ok: false, error: 'network unavailable' });
  });
});

describe('publishPackage dist-tag document', () => {
  it('Scenario: Given a publish distTag, When publishing, Then the registry document uses that dist-tag instead of latest', async () => {
    let capturedBody: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      if (typeof init?.body === 'string') capturedBody = init.body;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      publishPackage({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: 'pkg',
        version: '1.0.0',
        tarball: Buffer.from('hello'),
        metadata: { name: 'pkg', version: '1.0.0' },
        distTag: 'beta',
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedBody).not.toBeNull();
    if (capturedBody === null) throw new Error('Expected publish request body');
    const parsed: unknown = JSON.parse(capturedBody);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    expect(readRecordField(parsed, 'dist-tags')).toEqual({ beta: '1.0.0' });
  });

  it('Scenario: Given a publish access value, When publishing, Then the registry document includes access', async () => {
    let capturedBody: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      if (typeof init?.body === 'string') capturedBody = init.body;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      publishPackage({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: '@scope/pkg',
        version: '1.0.0',
        tarball: Buffer.from('hello'),
        metadata: { name: '@scope/pkg', version: '1.0.0' },
        access: 'public',
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedBody).not.toBeNull();
    if (capturedBody === null) throw new Error('Expected publish request body');
    const parsed: unknown = JSON.parse(capturedBody);
    expect(isRecord(parsed)).toBe(true);
    if (!isRecord(parsed)) return;
    expect(parsed.access).toBe('public');
  });

  it('Scenario: Given a publish OTP value, When publishing, Then the registry request uses that OTP', async () => {
    let capturedOtp: string | null = null;
    fetchSpy.mockImplementation(async (_input, init) => {
      capturedOtp = new Headers(init?.headers).get('npm-otp');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      publishPackage({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: 'pkg',
        version: '1.0.0',
        tarball: Buffer.from('hello'),
        metadata: { name: 'pkg', version: '1.0.0' },
        otp: '123456',
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    expect(capturedOtp).toBe('123456');
  });

  it('Scenario: Given an explicit publish OTP fails, When the registry returns a drift hint, Then no stored-secret retry is attempted', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ error: 'OTP validation failed' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          date: new Date(Date.now() + 90_000).toUTCString(),
        },
      });
    });

    await expect(
      publishPackage({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: 'pkg',
        version: '1.0.0',
        tarball: Buffer.from('hello'),
        metadata: { name: 'pkg', version: '1.0.0' },
        otp: '123456',
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      error: 'OTP validation failed',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('registry response body projection', () => {
  it('Scenario: Given an unstringifiable registry body, When classifying token expiry, Then no projection error escapes', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => isExpiredToken(403, circular)).not.toThrow();
    expect(isExpiredToken(403, circular)).toBe(false);
  });

  it('Scenario: Given OIDC setup returns non-JSON failure, When projecting stderr, Then the registry text is preserved', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response('not-json', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      });
    });

    await expect(
      configureOidc({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: '@scope/pkg',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'HTTP 500',
      stdout: '',
      stderr: 'not-json',
    });
  });

  it('Scenario: Given OIDC setup returns an npm errors array, When projecting the failure, Then the first structured message is used', async () => {
    fetchSpy.mockImplementation(async () => {
      return new Response(JSON.stringify({ errors: [{ summary: '2FA flag rejected', detail: 'package requires owner access' }] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      configureOidc({
        registry: 'https://registry.example.test/',
        token: 'npm_token',
        totpSecret: 'JBSWY3DPEHPK3PXP',
        name: '@scope/pkg',
      }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      error: '2FA flag rejected: package requires owner access',
      stdout: '',
      stderr: '{"errors":[{"summary":"2FA flag rejected","detail":"package requires owner access"}]}',
    });
  });
});
