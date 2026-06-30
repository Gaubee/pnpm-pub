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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
