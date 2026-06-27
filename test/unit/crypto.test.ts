/**
 * Import / export encryption tests (Chapter 10.2.2).
 *
 * Validates that the AES-256-GCM + PBKDF2 bundle round-trips losslessly,
 * rejects the wrong password (auth tag failure), and is non-trivial ciphertext.
 */
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { createCipheriv } from 'node:crypto';
import { exportBundle, importBundle, deriveKey } from '../../src/daemon/crypto.js';
import type { ProfileSecrets } from '../../src/daemon/crypto.js';
import type { BackupBundle } from '../../src/shared/index.js';

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

  it('Scenario: Given authenticated plaintext with an invalid secret shape, When importing, Then it fails closed', () => {
    const bundle = encryptedRawBundle(
      {
        john_doe: { token: 'npm_aBcD1234', totp: 123456 },
      },
      'pw',
    );

    expect(importBundle(bundle, 'pw')).toBeNull();
  });

  it('Scenario: Given authenticated plaintext that is not JSON, When importing, Then it fails closed', () => {
    const bundle = encryptedRawBundle('not-json', 'pw');

    expect(importBundle(bundle, 'pw')).toBeNull();
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

function encryptedRawBundle(plaintext: unknown, password: string): BackupBundle {
  const salt = Buffer.alloc(16, 1);
  const iv = Buffer.alloc(12, 2);
  const key = deriveKey(Buffer.from(password, 'utf8'), salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const text = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    profiles: ['john_doe'],
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: Buffer.concat([tag, ciphertext]).toString('hex'),
  };
}

describe('PBKDF2 key derivation', () => {
  it('produces a 32-byte key', () => {
    const salt = Buffer.alloc(16, 1);
    const key = deriveKey(Buffer.from('password', 'utf8'), salt);
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same salt + password', () => {
    const salt = Buffer.alloc(16, 9);
    expect(deriveKey(Buffer.from('pw', 'utf8'), salt)).toEqual(deriveKey(Buffer.from('pw', 'utf8'), salt));
  });

  it('differs across passwords', () => {
    const salt = Buffer.alloc(16, 9);
    expect(deriveKey(Buffer.from('pw1', 'utf8'), salt)).not.toEqual(deriveKey(Buffer.from('pw2', 'utf8'), salt));
  });

  it('derives from the caller-owned password buffer so the caller can burn the source', () => {
    const salt = Buffer.alloc(16, 7);
    const password = Buffer.from('burnable-password', 'utf8');
    const key = deriveKey(password, salt);

    password.fill(0);

    expect(key.length).toBe(32);
    expect(password.every((byte) => byte === 0)).toBe(true);
  });
});
