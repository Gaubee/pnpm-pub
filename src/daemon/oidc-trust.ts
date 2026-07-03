/**
 * npm Trusted Publishing (OIDC) trusted-publisher management — powered by
 * safe-npm-sdk (replaces all hand-written fetch + parse logic).
 *
 * The SDK handles auth headers, OTP injection, scoped-name escaping, retries,
 * and response parsing via Zod. This module is now a thin adapter that maps
 * the SDK's Result<T> pattern to the shape pnpm-pub's web-server expects.
 */
import {
  createClient,
  getTrustedPublishers,
  configureTrustedPublisher,
  deleteTrustedPublisher,
  type NpmClient,
  TrustedPublisherConfigCreateSchema,
} from "safe-npm-sdk";
import { generateTotp } from "./totp.js";
import { TrustedPublisherConfigSchema } from "../shared/schemas.js";
import type { TrustedPublisherConfig } from "../shared/index.js";
import type { TrustedPublisherCreateConfig } from "../shared/orpc-contract.js";

/** Credentials needed to construct a one-shot SDK client + OTP. */
export interface TrustAuth {
  registry: string;
  token: string;
  totpSecret: string;
}

export interface TrustResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** Build a transient SDK client from raw credentials. */
function makeClient(auth: TrustAuth): NpmClient {
  return createClient({
    auth: { token: auth.token },
    registry: auth.registry,
  });
}

/** Generate the current TOTP from the secret. */
function otp(auth: TrustAuth): string {
  return generateTotp(auth.totpSecret);
}

// ---------------------------------------------------------------------------
// GET — list trusted publishers for a package
// ---------------------------------------------------------------------------

export async function listTrustedPublishers(
  auth: TrustAuth,
  name: string,
): Promise<
  { ok: true; configs: TrustedPublisherConfig[] } | { ok: false; status: number; error: string }
> {
  const client = makeClient(auth);
  const result = await getTrustedPublishers(name, { otp: otp(auth) }, client);
  if (result.ok) {
    // The SDK returns TrustedPublisherConfigs (the parsed array/object shape).
    // Map to our shared type — shapes are structurally compatible.
    const configs = (result.data as unknown[]).filter(
      (c): c is TrustedPublisherConfig => c !== null,
    );
    return { ok: true, configs };
  }
  return { ok: false, status: result.error.status, error: result.error.message };
}

// ---------------------------------------------------------------------------
// POST — add a trusted publisher
// ---------------------------------------------------------------------------

export async function addTrustedPublisher(
  auth: TrustAuth,
  name: string,
  config: TrustedPublisherCreateConfig,
): Promise<TrustResult> {
  const client = makeClient(auth);
  const createConfig = TrustedPublisherConfigCreateSchema.parse(config);
  const result = await configureTrustedPublisher(name, createConfig, { otp: otp(auth) }, client);
  return {
    ok: result.ok,
    status: result.ok ? 200 : result.error.status,
    error: result.ok ? undefined : result.error.message,
  };
}

// ---------------------------------------------------------------------------
// DELETE — remove a trusted publisher by config id
// ---------------------------------------------------------------------------

export async function removeTrustedPublisher(
  auth: TrustAuth,
  name: string,
  uuid: string,
): Promise<TrustResult> {
  const client = makeClient(auth);
  const result = await deleteTrustedPublisher(
    { package: name, configUuid: uuid },
    { otp: otp(auth) },
    client,
  );
  return {
    ok: result.ok,
    status: result.ok ? 200 : result.error.status,
    error: result.ok ? undefined : result.error.message,
  };
}

// Re-export for web-server.ts body validation (POST route validates config shape).
export { TrustedPublisherConfigSchema };
export function parseTrustedPublisher(value: unknown): TrustedPublisherConfig | null {
  const r = TrustedPublisherConfigSchema.safeParse(value);
  return r.success ? r.data : null;
}
