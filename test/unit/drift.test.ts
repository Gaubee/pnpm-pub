/**
 * Clock-drift recovery integration test (Chapter 10.1.2 / 8.4).
 *
 * Stands up a mock registry whose first PUT fails with 403 "OTP validation
 * failed" AND a skewed `Date` header, then succeeds. Asserts publishPackage:
 *   - retries exactly once with a drift-compensated TOTP,
 *   - sets clockDriftRecovered on success,
 *   - does NOT retry when the failure is a real 401 (expired token).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { publishPackage, isExpiredToken } from '../../src/daemon/npm-api.js';

const SECRET = 'JBSWY3DPEHPK3PXP';

let server: http.Server;
let baseUrl = '';
let attempts: { otp: string | undefined; status: number }[] = [];
let mode: 'drift' | 'expired' = 'drift';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const otp = firstHeaderValue(req.headers['npm-otp']);
    if (req.method === 'PUT') {
      attempts.push({ otp, status: 0 });
      const n = attempts.length;
      if (mode === 'drift') {
        if (n === 1) {
          // First attempt: OTP failure with a server clock ~2 min ahead.
          res.writeHead(403, { 'content-type': 'application/json', date: new Date(Date.now() + 120_000).toUTCString() });
          res.end(JSON.stringify({ error: 'OTP validation failed' }));
          attempts[n - 1]!.status = 403;
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          attempts[n - 1]!.status = 200;
        }
      } else {
        // expired mode: always 401.
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'token expired' }));
        attempts[n - 1]!.status = 401;
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('Clock-drift recovery (Chapter 8.4 / 10.1.2)', () => {
  it('retries with a compensated TOTP and flags clockDriftRecovered', async () => {
    attempts = [];
    mode = 'drift';
    const result = await publishPackage({
      registry: baseUrl,
      token: 't',
      totpSecret: SECRET,
      name: 'drift-pkg',
      version: '1.0.0',
      tarball: Buffer.from('hello'),
      metadata: { name: 'drift-pkg', version: '1.0.0' },
    });
    expect(result.ok).toBe(true);
    expect(result.clockDriftRecovered).toBe(true);
    // Exactly two attempts: initial + one drift retry.
    expect(attempts.length).toBe(2);
    // The retry OTP must differ from the first (drift-compensated).
    expect(attempts[1]!.otp).not.toBe(attempts[0]!.otp);
  });

  it('does NOT retry on a real 401 expired token (marks expired, no drift)', async () => {
    attempts = [];
    mode = 'expired';
    const result = await publishPackage({
      registry: baseUrl,
      token: 't',
      totpSecret: SECRET,
      name: 'expired-pkg',
      version: '1.0.0',
      tarball: Buffer.from('hello'),
      metadata: { name: 'expired-pkg', version: '1.0.0' },
    });
    expect(result.ok).toBe(false);
    expect(result.expired).toBe(true);
    expect(result.clockDriftRecovered).toBeUndefined();
    expect(attempts.length).toBe(1); // no retry
  });
});

describe('isExpiredToken classification', () => {
  it('flags 401 and 403 token-revoked as expired', () => {
    expect(isExpiredToken(401, { error: 'x' })).toBe(true);
    expect(isExpiredToken(403, { error: 'token revoked' })).toBe(true);
  });
  it('does NOT flag a 403 OTP failure as expired', () => {
    expect(isExpiredToken(403, { error: 'OTP validation failed' })).toBe(false);
  });
});
