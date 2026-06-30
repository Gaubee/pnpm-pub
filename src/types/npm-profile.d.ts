declare module 'npm-profile' {
  export interface Options {
    registry?: string;
    token?: string;
    otp?: string;
    username?: string;
    password?: string;
    forceAuth?: {
      username: string;
      password: string;
      otp?: string;
    };
    query?: Record<string, string | number | boolean>;
    method?: string;
    body?: unknown;
    cache?: boolean;
    creds?: ProfileCredentials;
    hostname?: string;
  }

  export interface ProfileCredentials {
    username: string;
    email: string;
  }

  export interface ProfileAuthCredentials extends ProfileCredentials {
    password: string;
  }

  export interface ProfileAuthToken {
    token: string;
    username: string;
  }

  export interface ProfileData {
    tfa: TFAStatus;
    name: string;
    email: string;
    email_verified: boolean;
    created: Date | string;
    updated: Date | string;
    cidr_whitelist: null | string[];
    fullname?: string;
    homepage?: string;
    freenode?: string;
    twitter?: string;
    github?: string;
  }

  export type UpdateProfileData =
    & Partial<Omit<ProfileData, 'tfa' | 'created' | 'updated' | 'email_verified'>>
    & UpdateOptions;

  export interface UpdateOptions {
    password?: PasswordUpdate;
    tfa?: TFAStatusUpdate;
  }

  export interface PasswordUpdate {
    old: string;
    new: string;
  }

  export type TFAStatus =
    | null
    | false
    | {
        pending: boolean;
        [key: string]: unknown;
      }
    | [string, string]
    | string;

  export interface TFAStatusUpdate {
    password: string;
    mode: 'disable' | 'auth-only' | 'auth-and-writes';
  }

  export interface FetchProfileError extends Error {
    code: string;
    method: string;
    statusCode?: number;
    headers?: Record<string, string | string[] | undefined>;
    uri?: string;
    body?: unknown;
    pkgid?: string;
  }

  export interface Token {
    key: string;
    token: string | null;
    created: Date | string;
    updated: Date | string;
    readonly: boolean;
    cidr_whitelist: string[];
  }

  export function get(options?: Options): Promise<ProfileData>;

  export function set(updateOptions: UpdateProfileData, options?: Options): Promise<ProfileData>;

  export function listTokens(options?: Options): Promise<Token[]>;

  export function removeToken(tokenOrKey: string, options?: Options): Promise<void>;

  export function createToken(
    password: string,
    readonly: boolean,
    cidrWhitelist: string[],
    options?: Options,
  ): Promise<Token>;

  export function adduser(
    opener: (url: string) => Promise<void>,
    prompter: (creds: ProfileAuthCredentials) => Promise<ProfileAuthCredentials>,
    opts?: Options,
  ): Promise<ProfileAuthToken>;

  export function login(
    opener: (url: string) => Promise<void>,
    prompter: (creds: ProfileAuthCredentials) => Promise<ProfileAuthCredentials>,
    opts?: Options,
  ): Promise<ProfileAuthToken>;

  export function loginWeb(opener: (url: string) => Promise<void>, opts?: Options): Promise<ProfileAuthToken>;

  export function adduserWeb(opener: (url: string) => Promise<void>, opts?: Options): Promise<ProfileAuthToken>;

  export function adduserCouch(
    username: string,
    email: string,
    password: string,
    opts?: Options,
  ): Promise<ProfileAuthToken>;

  /**
   * npm-profile@12 runtime signature. DefinitelyTyped's extra `email`
   * parameter is stale for this package line.
   */
  export function loginCouch(
    username: string,
    password: string,
    opts?: Options,
  ): Promise<ProfileAuthToken>;
}
