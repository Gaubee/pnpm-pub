/**
 * Backup cryptography: PBKDF2 + AES-256-GCM (Chapter 8.2).
 *
 * Export:
 *   1. random salt + IV
 *   2. PBKDF2(stretch user password -> 256-bit key)
 *   3. AES-256-GCM encrypt { token, totp } bundle
 *
 * Import is the inverse. The exported JSON exposes plaintext profile metadata
 * (so the importer can show the list first) plus the encrypted ciphertext.
 */
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';
import type { BackupBundle } from '../shared/index.js';

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 recommendation for sha256
const KEY_LEN = 32; // 256 bits
const SALT_LEN = 16;
const IV_LEN = 12; // 96-bit nonce recommended for GCM
const AUTH_TAG_LEN = 16;

/** Stretch a user password into a 256-bit key using PBKDF2 (Chapter 8.2.4). */
export function deriveKey(password: string, salt: Buffer, iterations = PBKDF2_ITERATIONS): Buffer {
  return pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, KEY_LEN, 'sha256');
}

/** Encrypted payload: a per-profile record { token, totp }. */
export interface ProfileSecrets {
  [username: string]: { token: string; totp: string };
}

/**
 * Produce an encrypted BackupBundle from a map of profile secrets.
 * The user-supplied password is wiped from memory after derivation.
 */
export function exportBundle(
  secrets: ProfileSecrets,
  password: string,
): BackupBundle {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);

  const pwBuf = Buffer.from(password, 'utf8');
  const key = deriveKey(password, salt);
  pwBuf.fill(0); // burn password from memory (Chapter 8.1).

  const plaintext = Buffer.from(JSON.stringify(secrets), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Prepend the GCM auth tag so decryption can reattach it.
  const payload = Buffer.concat([tag, ciphertext]);

  key.fill(0);

  return {
    profiles: Object.keys(secrets),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    ciphertext: payload.toString('hex'),
  };
}

/**
 * Decrypt a BackupBundle with the user password. Returns null on bad password
 * / tampered ciphertext (GCM auth failure) rather than throwing.
 */
export function importBundle(
  bundle: BackupBundle,
  password: string,
): ProfileSecrets | null {
  try {
    const salt = Buffer.from(bundle.salt, 'hex');
    const iv = Buffer.from(bundle.iv, 'hex');
    const payload = Buffer.from(bundle.ciphertext, 'hex');

    const pwBuf = Buffer.from(password, 'utf8');
    const key = deriveKey(password, salt);
    pwBuf.fill(0);

    const tag = payload.subarray(0, AUTH_TAG_LEN);
    const ciphertext = payload.subarray(AUTH_TAG_LEN);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    key.fill(0);

    return JSON.parse(plaintext.toString('utf8')) as ProfileSecrets;
  } catch {
    return null;
  }
}

/** Strong random bytes helper, exposed for WebToken generation (Chapter 3.2.2). */
export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
