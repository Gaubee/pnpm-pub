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
import { burnBuffer } from './totp.js';

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 recommendation for sha256
const KEY_LEN = 32; // 256 bits
const SALT_LEN = 16;
const IV_LEN = 12; // 96-bit nonce recommended for GCM
const AUTH_TAG_LEN = 16;

/**
 * Stretch a caller-owned password buffer into a 256-bit key using PBKDF2
 * (Chapter 8.2.4). The caller remains responsible for burning `password`.
 */
export function deriveKey(password: Buffer, salt: Buffer, iterations = PBKDF2_ITERATIONS): Buffer {
  return pbkdf2Sync(password, salt, iterations, KEY_LEN, 'sha256');
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
  const plaintext = Buffer.from(JSON.stringify(secrets), 'utf8');
  let key: Buffer | null = null;
  try {
    key = deriveKey(pwBuf, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Prepend the GCM auth tag so decryption can reattach it.
    const payload = Buffer.concat([tag, ciphertext]);

    return {
      profiles: Object.keys(secrets),
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext: payload.toString('hex'),
    };
  } finally {
    burnBuffer(pwBuf);
    burnBuffer(plaintext);
    if (key) burnBuffer(key);
  }
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
    let key: Buffer | null = null;
    let plaintext: Buffer | null = null;
    try {
      key = deriveKey(pwBuf, salt);
      const tag = payload.subarray(0, AUTH_TAG_LEN);
      const ciphertext = payload.subarray(AUTH_TAG_LEN);

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);

      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
      return parseProfileSecrets(parsed);
    } finally {
      burnBuffer(pwBuf);
      if (key) burnBuffer(key);
      if (plaintext) burnBuffer(plaintext);
    }
  } catch {
    return null;
  }
}

/** Strong random bytes helper, exposed for WebToken generation (Chapter 3.2.2). */
export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function parseProfileSecrets(value: unknown): ProfileSecrets | null {
  if (!isRecord(value)) return null;
  const secrets: ProfileSecrets = {};
  for (const [username, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.token !== 'string' || typeof entry.totp !== 'string') {
      return null;
    }
    secrets[username] = { token: entry.token, totp: entry.totp };
  }
  return secrets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
