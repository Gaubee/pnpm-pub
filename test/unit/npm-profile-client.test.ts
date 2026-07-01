import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  loginWithPassword,
  readAuthenticatedProfile,
  readProfileDetail,
  isManualTokenFallbackError,
  resultErrorMessage,
} from '../../src/daemon/npm-profile-client.js';

/**
 * The boundary now delegates to `safe-npm-sdk`'s loginCouch/getProfile, which
 * use the SDK's never-throws `Result` model. Mock those SDK entry points and
 * assert the boundary maps results → thrown errors / guarded facts.
 */
const sdk = vi.hoisted(() => {
  // Lightweight stand-ins for the SDK error classes so instanceof checks in the
  // boundary behave. The auth subclasses must be DISTINCT classes (they extend
  // the base) so a generic non-auth error isn't mis-classified as OTP/IP.
  class MockNpmApiError extends Error {
    status: number;
    code: string;
    constructor(opts: { status: number; message: string; code?: string }) {
      super(opts.message);
      this.name = 'NpmApiError';
      this.status = opts.status;
      this.code = opts.code ?? `E${opts.status}`;
    }
  }
  class MockNpmApiErrorAuthOTP extends MockNpmApiError {}
  class MockNpmApiErrorAuthIPAddress extends MockNpmApiError {}
  return {
    loginCouch: vi.fn(),
    getProfile: vi.fn(),
    MockNpmApiError,
    MockNpmApiErrorAuthOTP,
    MockNpmApiErrorAuthIPAddress,
  };
});

vi.mock('safe-npm-sdk', () => ({
  createClient: vi.fn(() => ({ registry: 'mock', auth: undefined })),
  loginCouch: sdk.loginCouch,
  getProfile: sdk.getProfile,
  NpmApiError: sdk.MockNpmApiError,
  NpmApiErrorAuthOTP: sdk.MockNpmApiErrorAuthOTP,
  NpmApiErrorAuthIPAddress: sdk.MockNpmApiErrorAuthIPAddress,
  tfaIsOtpauth: (tfa: unknown) => typeof tfa === 'string' && String(tfa).startsWith('otpauth://'),
  tfaIsRecoveryCodes: (tfa: unknown) => Array.isArray(tfa),
}));

afterEach(() => {
  vi.clearAllMocks();
});

/** Build an SDK-style ok result. */
function ok<T>(data: T) {
  return { ok: true as const, data, response: { status: 200, headers: new Headers(), body: data } };
}
/** Build an SDK-style err result carrying a structured error. */
function err(error: Error) {
  return { ok: false as const, error, response: { status: 500, headers: new Headers(), body: null } };
}

describe('npm-profile client boundary (safe-npm-sdk)', () => {
  it('Scenario: Given loginCouch returns a token, When logging in, Then the guarded session is returned', async () => {
    sdk.loginCouch.mockResolvedValue(ok({ token: 'npm_token', name: 'alice' }));

    await expect(
      loginWithPassword('alice', 'secret-password', {
        registry: 'https://registry.example.test/',
        otp: '123456',
      }),
    ).resolves.toEqual({
      token: 'npm_token',
      username: 'alice',
    });
  });

  it('Scenario: Given loginCouch omits a token, When logging in, Then no credential fact is accepted', async () => {
    sdk.loginCouch.mockResolvedValue(ok({ token: null, name: 'alice' }));

    await expect(
      loginWithPassword('alice', 'secret-password', { registry: 'https://registry.example.test/' }),
    ).rejects.toThrow('npm registry login returned no token.');
  });

  it('Scenario: Given loginCouch fails with an OTP challenge, When logging in, Then the error surfaces and is a manual-token fallback', async () => {
    const otpError = new sdk.MockNpmApiError({ status: 401, message: 'One-time pass required.', code: 'EOTP' });
    sdk.loginCouch.mockResolvedValue(err(otpError));

    await expect(
      loginWithPassword('alice', 'secret-password', { registry: 'https://registry.example.test/' }),
    ).rejects.toThrow('One-time pass required.');

    expect(isManualTokenFallbackError(otpError)).toBe(true);
    expect(resultErrorMessage(otpError)).toBe('One-time pass required.');
  });

  it('Scenario: Given a non-auth error, When logging in, Then it is NOT a manual-token fallback', async () => {
    const notFound = new sdk.MockNpmApiError({ status: 404, message: 'user not found' });
    expect(isManualTokenFallbackError(notFound)).toBe(false);
  });

  it('Scenario: Given authenticated profile fields, When reading profile, Then typed name and email facts are returned', async () => {
    sdk.getProfile.mockResolvedValue(
      ok({
        name: 'alice',
        email: 'alice@example.com',
        tfa: null,
      }),
    );

    await expect(readAuthenticatedProfile('npm_token', 'https://registry.example.test/')).resolves.toEqual({
      name: 'alice',
      email: 'alice@example.com',
      avatarUrl: null,
    });
  });

  it('Scenario: Given a full profile, When reading detail, Then all projections are normalized', async () => {
    sdk.getProfile.mockResolvedValue(
      ok({
        name: 'alice',
        fullname: 'Alice Doe',
        email: 'alice@example.com',
        email_verified: true,
        github: 'alice',
        twitter: null,
        homepage: 'https://alice.example.test',
        tfa: { mode: 'auth-and-writes' },
        created: '2020-01-02T03:04:05.000Z',
      }),
    );

    await expect(readProfileDetail('npm_token', 'https://registry.example.test/')).resolves.toEqual({
      name: 'alice',
      fullname: 'Alice Doe',
      email: 'alice@example.com',
      emailVerified: true,
      github: 'alice',
      twitter: null,
      homepage: 'https://alice.example.test',
      tfaEnabled: true,
      createdAt: '2020-01-02T03:04:05.000Z',
    });
  });
});
