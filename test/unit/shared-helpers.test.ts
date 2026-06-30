/**
 * Tests for shared keychain account-key helpers (Chapter 4.2).
 */
import { describe, it, expect } from 'vitest';
import { tokenKey, totpKey, authKey, KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_SANDBOX } from '../../src/shared/index.js';

describe('Keychain account-key helpers', () => {
  it('tokenKey: <username>_npm_token', () => {
    expect(tokenKey('john_doe')).toBe('john_doe_npm_token');
    expect(tokenKey('@scope/user')).toBe('@scope/user_npm_token');
  });

  it('totpKey: <username>_totp_secret', () => {
    expect(totpKey('john_doe')).toBe('john_doe_totp_secret');
  });

  it('authKey: pnpm_pub-key<username>-auth (merged item)', () => {
    expect(authKey('john_doe')).toBe('pnpm_pub-keyjohn_doe-auth');
    expect(authKey('@scope/user')).toBe('pnpm_pub-key@scope/user-auth');
  });

  it('authKey is distinct from tokenKey and totpKey', () => {
    const u = 'alice';
    expect(authKey(u)).not.toBe(tokenKey(u));
    expect(authKey(u)).not.toBe(totpKey(u));
  });

  it('service name constants', () => {
    expect(KEYCHAIN_SERVICE).toBe('pnpm-pub');
    expect(KEYCHAIN_SERVICE_SANDBOX).toBe('pnpm-pub-test-sandbox');
  });
});
