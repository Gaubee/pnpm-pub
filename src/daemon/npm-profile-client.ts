/**
 * Typed boundary around `npm-profile`.
 *
 * Callers consume guarded facts: login token and authenticated profile email.
 * The module declaration in `src/types/npm-profile.d.ts` is maintained against
 * npm-profile@12's runtime signatures.
 */
import { get, loginCouch, type Options, type ProfileAuthToken, type ProfileData } from 'npm-profile';

export interface NpmProfileAuthenticatedUser {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Full authenticated profile projection — the fields npm-profile's `get()`
 * exposes that are useful to render on the Profile detail page. Sensitive or
 * volatile fields (password, token) are intentionally NOT included.
 */
export interface NpmProfileDetail {
  name: string | null;
  fullname: string | null;
  email: string | null;
  emailVerified: boolean | null;
  github: string | null;
  twitter: string | null;
  homepage: string | null;
  tfaEnabled: boolean | null;
  createdAt: string | null;
}

export interface NpmProfileSession {
  token: string;
  username: string | null;
}

export interface NpmProfileAuthOptions {
  registry: string;
  otp?: string;
}

export async function loginWithPassword(
  username: string,
  password: string,
  options: NpmProfileAuthOptions,
): Promise<NpmProfileSession> {
  const result: ProfileAuthToken = await loginCouch(username, password, {
    registry: options.registry,
    otp: options.otp,
  });
  const token = readString(result.token);
  if (!token) {
    throw new Error('npm-profile login returned no token.');
  }
  return {
    token,
    username: readString(result.username),
  };
}

export async function readAuthenticatedProfile(
  token: string,
  registry: string,
): Promise<NpmProfileAuthenticatedUser> {
  const profile: ProfileData = await get({ registry, token });
  return {
    name: readString(profile.name),
    email: readString(profile.email),
    avatarUrl: null,
  };
}

/** Read the full authenticated profile (name/email/social/tfa/created). */
export async function readProfileDetail(
  token: string,
  registry: string,
): Promise<NpmProfileDetail> {
  const profile: ProfileData = await get({ registry, token });
  return {
    name: readString(profile.name),
    fullname: readString(profile.fullname),
    email: readString(profile.email),
    emailVerified: typeof profile.email_verified === 'boolean' ? profile.email_verified : null,
    github: readString(profile.github),
    twitter: readString(profile.twitter),
    homepage: readString(profile.homepage),
    tfaEnabled: profile.tfa ? parseTfaEnabled(profile.tfa) : null,
    createdAt: profile.created ? normalizeDate(profile.created) : null,
  };
}

/** npm-profile's `tfa` is `pending` | { mode, pending } — enabled when mode is set. */
function parseTfaEnabled(tfa: unknown): boolean | null {
  if (typeof tfa === 'string') return tfa === 'auth-and-writes' || tfa === 'auth-only';
  if (tfa && typeof tfa === 'object') {
    const mode = readString((tfa as Record<string, unknown>).mode);
    if (mode) return mode === 'auth-and-writes' || mode === 'auth-only';
  }
  return null;
}

function normalizeDate(value: Date | string): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = readString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? text : new Date(ms).toISOString();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
