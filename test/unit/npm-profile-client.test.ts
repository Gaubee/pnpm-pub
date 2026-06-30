import { describe, expect, it, vi, afterEach } from 'vitest';
import { loginWithPassword, readAuthenticatedProfile } from '../../src/daemon/npm-profile-client.js';

const profileMocks = vi.hoisted(() => ({
  loginCouch: vi.fn(),
  get: vi.fn(),
}));

vi.mock('npm-profile', () => ({
  loginCouch: profileMocks.loginCouch,
  get: profileMocks.get,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('npm-profile client boundary', () => {
  it('Scenario: Given npm-profile login returns a token, When logging in, Then the guarded session is returned', async () => {
    profileMocks.loginCouch.mockResolvedValue({
      token: 'npm_token',
      username: 'alice',
    });

    await expect(
      loginWithPassword('alice', 'secret-password', {
        registry: 'https://registry.example.test/',
        otp: '123456',
      }),
    ).resolves.toEqual({
      token: 'npm_token',
      username: 'alice',
    });

    expect(profileMocks.loginCouch).toHaveBeenCalledWith('alice', 'secret-password', {
      registry: 'https://registry.example.test/',
      otp: '123456',
    });
  });

  it('Scenario: Given npm-profile login omits token, When logging in, Then no credential fact is accepted', async () => {
    profileMocks.loginCouch.mockResolvedValue({
      token: 42,
      username: 'alice',
    });

    await expect(
      loginWithPassword('alice', 'secret-password', {
        registry: 'https://registry.example.test/',
      }),
    ).rejects.toThrow('npm-profile login returned no token.');
  });

  it('Scenario: Given authenticated profile fields, When reading profile, Then typed name and email facts are returned', async () => {
    profileMocks.get.mockResolvedValue({
      name: 'alice',
      email: 'alice@example.com',
      avatar: 'https://img.example.test/alice.png',
      github: 42,
    });

    await expect(readAuthenticatedProfile('npm_token', 'https://registry.example.test/')).resolves.toEqual({
      name: 'alice',
      email: 'alice@example.com',
      avatarUrl: null,
    });

    expect(profileMocks.get).toHaveBeenCalledWith({
      registry: 'https://registry.example.test/',
      token: 'npm_token',
    });
  });
});
