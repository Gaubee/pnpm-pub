/**
 * Authenticated fetch wrapper — every daemon REST call goes through this.
 * Automatically injects the `Authorization: Bearer <webToken>` header so
 * callers never have to manually add it (eliminates the 401 class of bugs
 * where a fetch was missing the auth header).
 */
import { readWebToken } from "./store.js";

export interface ApiFetchOptions extends RequestInit {
  /** Override the auth token (defaults to readWebToken()). */
  token?: string;
}

/**
 * Fetch wrapper that injects the WebUI's Bearer token into every request.
 * Use this for ALL daemon `/api/*` calls instead of raw `fetch`.
 */
export async function apiFetch(input: string, options: ApiFetchOptions = {}): Promise<Response> {
  const token = options.token ?? readWebToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...options, headers });
}
