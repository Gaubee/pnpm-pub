/**
 * TOTP conformance tests (Chapter 10.1.1).
 *
 * Validates against the RFC 6238 / RFC 4226 reference vectors. The RFC uses the
 * ASCII secret "12345678901234567890" which in base32 is
 * "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ". The expected 8-digit truncations at the
 * canonical T values (T = epoch / 30) are documented in RFC 6238 Appendix B.
 *
 * otplib produces 6-digit codes, so we validate against the HOTP reference
 * counter values (RFC 4226 Appendix D) which otplib also honours.
 */
import { describe, it, expect } from 'vitest';
import { authenticator, hotp } from 'otplib';
import { generateTotp, generateTotpAt, computeClockOffset, parseHttpDate, totpAfterDrift } from '../../src/daemon/totp.js';

describe('TOTP RFC conformance', () => {
  // RFC 4226 Appendix D — HOTP reference values for secret "12345678901234567890".
  const rfcSecretAscii = '12345678901234567890';
  const rfcHotpExpected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

  it('matches RFC 4226 HOTP table for counters 0..9', () => {
    for (let counter = 0; counter < rfcHotpExpected.length; counter++) {
      const code = hotp.generate(rfcSecretAscii, counter);
      expect(code).toBe(rfcHotpExpected[counter]);
    }
  });

  it('generates a 6-digit numeric code', () => {
    const code = generateTotp('JBSWY3DPEHPK3PXP');
    expect(code).toMatch(/^\d{6}$/);
  });

  it('matches the RFC 6238 Appendix B TOTP reference table (SHA-1, 8-digit)', () => {
    // RFC 6238 Appendix B vectors for SHA-1, secret "12345678901234567890" (ASCII).
    // The RFC table uses 8 digits; configure the HOTP instance to match.
    hotp.options = { digits: 8, algorithm: 'sha1' };
    const secret = '12345678901234567890';
    // (unixTime, expected 8-digit code) pairs from the RFC table.
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, expected] of vectors) {
      const counter = Math.floor(t / 30);
      expect(hotp.generate(secret, counter)).toBe(expected);
    }
    // Restore default for any subsequent HOTP assertions.
    hotp.options = { digits: 6, algorithm: 'sha1' };
  });

  it('produces the same code for the same second within a step', () => {
    const fixed = Date.UTC(2024, 0, 1, 0, 0, 5); // 5s into a step
    const a = generateTotpAt('JBSWY3DPEHPK3PXP', fixed);
    const b = generateTotpAt('JBSWY3DPEHPK3PXP', fixed);
    expect(a).toBe(b);
  });

  it('produces a different code across a step boundary', () => {
    const before = Date.UTC(2024, 0, 1, 0, 0, 0);
    const after = Date.UTC(2024, 0, 1, 0, 0, 31);
    expect(generateTotpAt('JBSWY3DPEHPK3PXP', before)).not.toBe(generateTotpAt('JBSWY3DPEHPK3PXP', after));
  });
});

describe('Clock-drift self-healing (Chapter 10.1.2 / 8.4)', () => {
  it('computeClockOffset returns server minus local time', () => {
    expect(computeClockOffset(1_000_000, 999_000)).toBe(1_000);
    expect(computeClockOffset(999_000, 1_000_000)).toBe(-1_000);
  });

  it('parseHttpDate parses an RFC 1123 date or null', () => {
    expect(parseHttpDate('Wed, 21 Oct 2015 07:28:00 GMT')).toBe(Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'));
    expect(parseHttpDate(null)).toBeNull();
    expect(parseHttpDate('not a date')).toBeNull();
  });

  it('totpAfterDrift produces the code the server would accept', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const serverTime = Date.UTC(2024, 0, 1, 0, 0, 0) + 60_000; // server 60s ahead
    const expectedAtServer = generateTotpAt(secret, serverTime);
    // The drift-correction routine should reconstruct the server's code from the
    // local perspective (it shifts the epoch by the computed offset).
    expect(totpAfterDrift(secret, serverTime)).toBe(expectedAtServer);
  });
});

describe('authenticator integration', () => {
  it('round-trips a token through otplib verify', () => {
    const secret = authenticator.generateSecret();
    const token = authenticator.generate(secret);
    expect(authenticator.check(token, secret)).toBe(true);
  });
});
