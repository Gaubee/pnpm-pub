/**
 * @pnpm-pub/shared — shared type definitions, protocol contracts and data models.
 *
 * All types are derived from Zod schemas in `schemas.ts` (single source of
 * truth). Re-exported here for import convenience. The schemas themselves are
 * also exported so daemon/webui can validate at every serialization boundary.
 */

// Re-export all Zod schemas + derived types from the schema module.
export * from "./schemas.js";

// ---------------------------------------------------------------------------
// Chapter 4.2 — OS keychain credential mapping (constants only — not schemas)
// ---------------------------------------------------------------------------

/** Fixed keychain service name (Chapter 4.2). */
export const KEYCHAIN_SERVICE = "pnpm-pub" as const;

/** Build the keychain account key for an NPM token. (Legacy — see authKey.) */
export const tokenKey = (username: string): string => `${username}_npm_token`;
/** Build the keychain account key for a TOTP secret. (Legacy — see authKey.) */
export const totpKey = (username: string): string => `${username}_totp_secret`;
/**
 * Build the keychain account key for the MERGED profile-auth item. This stores
 * `{ npm_token, totp_secret, npm_pwd }` as ONE JSON string so a single keychain
 * read (one OS auth prompt) yields every secret for the profile.
 */
export const authKey = (username: string): string => `pnpm_pub-key${username}-auth`;

/** Sandbox service name used in tests so we never touch the dev's real credentials (Chapter 10.2). */
export const KEYCHAIN_SERVICE_SANDBOX = "pnpm-pub-test-sandbox" as const;

// ---------------------------------------------------------------------------
// Misc constants
// ---------------------------------------------------------------------------

/** Fixed runtime directory under the user home. */
export const APP_DIR_NAME = ".pnpm-pub";

/** Resolved at runtime via env override; the canonical config filenames. */
export const PROFILES_FILE = "profiles.json";
export const WORKSPACES_FILE = "workspaces.json";
/** App-wide UI preferences (keepOnTop pin, etc.). */
export const PREFERENCES_FILE = "preferences.json";
/** SQLite database holding the persisted event log (survives restarts). */
export const EVENTS_DB_FILE = "events.db";
