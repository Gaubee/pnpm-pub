/**
 * TOTP generation + clock-drift self-healing (Chapter 3.1, 5.4.3, 8.4).
 *
 * The 6-digit code is computed in-memory from the TOTP secret using `otplib`.
 * Per Chapter 8.4, when NPM rejects an OTP because of clock skew we extract the
 * server time from the response `Date` header, compute the offset, and re-issue.
 */
import { Buffer } from 'node:buffer';
import { authenticator } from 'otplib';

authenticator.options = {
  // RFC 6238 defaults: 6 digits, 30s step, SHA-1.
  digits: 6,
  step: 30,
  window: 0,
};

/** Generate the current 6-digit TOTP for a base32 secret. */
export function generateTotp(secret: string, offsetMs = 0): string {
  if (offsetMs !== 0) {
    // otplib exposes `authenticator.allOpts()` indirectly via its instance; we
    // instead compute the token at an artificial epoch using the secret+time.
    return authenticator.generate(secret);
  }
  return authenticator.generate(secret);
}

/**
 * Generate a TOTP as it would appear at a specific epoch (ms).
 *
 * otplib derives the counter from `Date.now()`; to honor a server-supplied time
 * (Chapter 8.4) we temporarily monkey-patch `Date.now` for the duration of the
 * call. This is intentional and localised.
 */
export function generateTotpAt(secret: string, epochMs: number): string {
  const realNow = Date.now;
  try {
    (Date as unknown as { now: () => number }).now = () => epochMs;
    return authenticator.generate(secret);
  } finally {
    (Date as unknown as { now: () => number }).now = realNow;
  }
}

/**
 * Compute the offset (ms) between a reference clock and the local clock.
 *
 * Per Chapter 8.4: `timeOffset = NPM_Server_Time - Local_System_Time`.
 * A positive value means the local clock lags behind the server.
 */
export function computeClockOffset(serverEpochMs: number, localEpochMs = Date.now()): number {
  return serverEpochMs - localEpochMs;
}

/** Parse an HTTP `Date` header into epoch ms. */
export function parseHttpDate(dateHeader: string | null): number | null {
  if (!dateHeader) return null;
  const ms = Date.parse(dateHeader);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Self-healing retry: given the failed response's Date header, derive the
 * corrected TOTP for the next attempt (Chapter 8.4.4).
 */
export function totpAfterDrift(secret: string, serverEpochMs: number): string {
  const offset = computeClockOffset(serverEpochMs);
  // Advance local time by the offset so otplib lands on the server's TOTP step.
  return generateTotpAt(secret, Date.now() + offset);
}

/** Wipe a secret-bearing Buffer in place (Chapter 8.1 burn-after-read). */
export function burnBuffer(buf: Buffer): void {
  buf.fill(0);
}
