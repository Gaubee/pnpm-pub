/**
 * Import / export encryption tests (Chapter 10.2.2).
 *
 * Validates that the AES-256-GCM + PBKDF2 bundle round-trips losslessly,
 * rejects the wrong password (auth tag failure), and is non-trivial ciphertext.
 */
import { describe, it, expect } from 'vitest';
import { exportBundle, importBundle, deriveKey } from '../../src/daemon/crypto.js';
import type { ProfileSecrets } from '../../src/daemon/crypto.js';

const secrets: ProfileSecrets = {
  john_doe: { token: 'npm_aBcD1234', totp: 'JBSWY3DPEHPK3PXP' },
  work: { token: 'npm_xyz78900', totp: 'KRSXG5CTMVRXEZDU' },
};

describe('Backup crypto round-trip', () => {
  it('decrypts to the original secrets with the correct password', () => {
    const bundle = exportBundle(secrets, 'correct-horse-battery-staple');
    const decoded = importBundle(bundle, 'correct-horse-battery-staple');
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(secrets);
  });

  it('returns null on the wrong password (GCM auth failure)', () => {
    const bundle = exportBundle(secrets, 'right');
    expect(importBundle(bundle, 'wrong')).toBeNull();
  });

  it('exposes the plaintext profile list in the bundle', () => {
    const bundle = exportBundle(secrets, 'pw');
    expect(bundle.profiles).toEqual(['john_doe', 'work']);
  });

  it('ciphertext is non-trivial (not the raw token string)', () => {
    const bundle = exportBundle(secrets, 'pw');
    expect(bundle.ciphertext).not.toContain('npm_aBcD1234');
    expect(bundle.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('salt and IV are unique per export', () => {
    const a = exportBundle(secrets, 'pw');
    const b = exportBundle(secrets, 'pw');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('PBKDF2 key derivation', () => {
  it('produces a 32-byte key', () => {
    const salt = Buffer.alloc(16, 1);
    const key = deriveKey('password', salt);
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same salt + password', () => {
    const salt = Buffer.alloc(16, 9);
    expect(deriveKey('pw', salt)).toEqual(deriveKey('pw', salt));
  });

  it('differs across passwords', () => {
    const salt = Buffer.alloc(16, 9);
    expect(deriveKey('pw1', salt)).not.toEqual(deriveKey('pw2', salt));
  });
});
