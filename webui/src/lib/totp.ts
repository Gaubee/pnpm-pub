/**
 * TOTP secret handling for the Add Profile dialog.
 *
 * Modelled on the gaubee/2fa reference project: the daemon only persists a
 * Base32 secret, but users paste it in many shapes. We accept:
 *   - raw Base32 (RFC 4648, no padding), e.g. `JBSWY3DPEHPK3PXP`
 *   - spaced / hyphenated / lowercased, e.g. `jbsw y3dp-ehpk 3pxp`
 *   - a full `otpauth://totp/<label>?secret=...&issuer=...` URI
 *   - `label|secret` / `label,secret` shorthand lines
 *
 * The output is always a single normalized, Base32-validated secret string
 * suitable for `POST /api/add-profile { totpSecret }`.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** True for a clean (no spaces / padding) Base32 character run. */
export function isBase32Secret(secret: string): boolean {
  return /^[A-Z2-7]+=*$/.test(secret);
}

/**
 * Strip separators and upper-case, matching the reference project's Rust
 * `normalize_secret` (drops spaces, tabs, newlines, hyphens).
 */
export function normalizeBase32Secret(secret: string): string {
  return secret.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
}

export interface ParsedTotp {
  secret: string;
  /** Optional label carried by an otpauth://, otpauth-migration:// or line. */
  label?: string;
  /**
   * Optional account/username carried by the URI (migration `name` field,
   * the label part of `label|secret`, or the account segment of an
   * `otpauth://` path label). Used to auto-fill the Add Profile username.
   * Best-effort — not guaranteed to be a valid npm username.
   */
  account?: string;
}

/**
 * Parse arbitrary user input into a normalized Base32 secret. Returns null
 * when no valid secret can be extracted.
 *
 * - `otpauth://totp/...?secret=...` → reads the secret param (and optional label).
 * - `otpauth-migration://offline?data=...` → protobuf bundle; returns the first
 *   valid TOTP entry (use {@link parseTotpSecrets} to get all of them).
 * - `label|secret` / `label,secret`  → uses the second field.
 * - otherwise the whole string is treated as the secret.
 */
export function parseTotpSecret(input: string): ParsedTotp | null {
  const all = parseTotpSecrets(input);
  return all.length > 0 ? all[0]! : null;
}

/**
 * Like {@link parseTotpSecret} but returns every secret found. A migration URI
 * can carry multiple accounts; everything else returns a single-element array
 * (or empty on failure). Used by the Add Profile field to detect "this paste
 * has N secrets" — the field surfaces a hint rather than silently dropping them.
 */
export function parseTotpSecrets(input: string): ParsedTotp[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (/^otpauth-migration:\/\//i.test(trimmed)) {
    return parseOtpauthMigrationUri(trimmed);
  }

  const otpauth = tryParseOtpauthUri(trimmed);
  if (otpauth) return [otpauth];

  const sep = tryParseLabelSecretLine(trimmed);
  if (sep) return [sep];

  const secret = normalizeBase32Secret(trimmed);
  if (!secret || !isBase32Secret(secret) || !isValidBase32(secret)) return [];
  return [{ secret }];
}

/** Normalize + validate a raw secret (no URI / label parsing). */
export function coerceTotpSecret(input: string): string | null {
  const secret = normalizeBase32Secret(input);
  if (!secret || !isBase32Secret(secret) || !isValidBase32(secret)) return null;
  return secret;
}

/** Error message for a secret the user typed; empty string when it's valid. */
export function totpSecretError(input: string): string {
  if (!input.trim()) return "";
  const all = parseTotpSecrets(input);
  if (all.length === 0) return "Unsupported format. Paste a Base32 secret or an otpauth:// URI.";
  if (all.length > 1) {
    return `This bundle has ${all.length} secrets — only the first (“${all[0]!.label ?? all[0]!.secret}”) will be used.`;
  }
  return "";
}

function tryParseOtpauthUri(value: string): ParsedTotp | null {
  if (!/^otpauth:\/\/totp\//i.test(value)) return null;
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return null;
  }
  if (uri.hostname.toLowerCase() !== "totp") return null;
  const secret = coerceTotpSecret(uri.searchParams.get("secret") ?? "");
  if (!secret) return null;
  const issuer = (uri.searchParams.get("issuer") ?? "").trim();
  const pathLabel = decodeURIComponent(uri.pathname.replace(/^\//, "")).trim();
  // otpauth:// path label is conventionally "Issuer:Account" or just "Account".
  // The account is the segment after the colon (or the whole label if none).
  const account = pathLabel.includes(":") ? pathLabel.split(/:(.+)/)[1]!.trim() : pathLabel;
  const label = issuer || pathLabel || undefined;
  return { secret, label, account: account || undefined };
}

function tryParseLabelSecretLine(value: string): ParsedTotp | null {
  // Reject anything that looks like a URL — those belong to otpauth parsing.
  if (/^[a-z]+:\/\//i.test(value)) return null;
  const sepIndex = Math.max(value.indexOf("|"), value.indexOf(","));
  if (sepIndex <= 0) return null;
  const secret = coerceTotpSecret(value.slice(sepIndex + 1));
  if (!secret) return null;
  const account = value.slice(0, sepIndex).trim();
  const label = account || undefined;
  return { secret, label, account: account || undefined };
}

// ----- otpauth-migration:// (Google Authenticator export bundle) -----
// Modelled on the gaubee/2fa reference parser: the `data` query param is a
// base64url protobuf whose repeated field #1 is an `OtpParameters` message with
// a raw secret byte array (#1), an account name (#2), an issuer (#3) and an
// algorithm/type enum (#6). We only emit type==2 (TOTP) entries.

function parseOtpauthMigrationUri(value: string): ParsedTotp[] {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return [];
  }
  if (uri.protocol !== "otpauth-migration:") return [];

  const data = (uri.searchParams.get("data") ?? "").trim();
  if (!data) return [];

  let payload: Uint8Array;
  try {
    payload = base64UrlToBytes(data);
  } catch {
    return [];
  }

  const results: ParsedTotp[] = [];
  for (const field of parseProtoFields(payload)) {
    if (field.fieldNumber !== 1 || field.wireType !== 2 || !(field.value instanceof Uint8Array)) {
      continue;
    }
    const entry = parseMigrationOtpParameter(field.value);
    if (entry) results.push(entry);
  }
  return results;
}

function parseMigrationOtpParameter(raw: Uint8Array): ParsedTotp | null {
  let secretBytes: Uint8Array | null = null;
  let name = "";
  let issuer = "";
  let type = 2; // 2 = TOTP (per Google's otp_type enum)

  for (const field of parseProtoFields(raw)) {
    if (field.fieldNumber === 1 && field.wireType === 2 && field.value instanceof Uint8Array) {
      secretBytes = field.value;
    } else if (
      field.fieldNumber === 2 &&
      field.wireType === 2 &&
      field.value instanceof Uint8Array
    ) {
      name = bytesToUtf8(field.value).trim();
    } else if (
      field.fieldNumber === 3 &&
      field.wireType === 2 &&
      field.value instanceof Uint8Array
    ) {
      issuer = bytesToUtf8(field.value).trim();
    } else if (field.fieldNumber === 6 && field.wireType === 0 && typeof field.value === "number") {
      type = field.value;
    }
  }

  if (!(secretBytes instanceof Uint8Array) || secretBytes.length === 0) return null;
  if (type !== 2) return null; // skip HOTP (1) / unspecified (0)

  const secret = coerceTotpSecret(bytesToBase32(secretBytes));
  if (!secret) return null;

  const account = name.includes(":") ? name.split(/:(.+)/)[1]!.trim() : name.trim();
  const label = issuer && account ? `${issuer} / ${account}` : account || issuer || undefined;
  return { secret, label, account: account || undefined };
}

interface ProtoField {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
}

function parseProtoFields(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  /**
   * readProtoVarint can throw on truncated/overflowing input. We treat ANY
   * malformed byte run as "stop parsing here" — returning whatever was parsed
   * so far — so a bad migration paste never throws out of `$derived` and
   * crashes the Add Profile form. This mirrors how real protobuf decoders
   * handle truncated streams.
   */
  const readVarintOrBail = (at: number): { value: number; next: number } | null => {
    try {
      return readProtoVarint(bytes, at);
    } catch {
      return null;
    }
  };

  while (offset < bytes.length) {
    const key = readVarintOrBail(offset);
    if (!key) return fields; // malformed varint — stop
    offset = key.next;
    const fieldNumber = key.value >>> 3;
    const wireType = key.value & 0x07;

    if (wireType === 0) {
      // varint
      const value = readVarintOrBail(offset);
      if (!value) return fields; // malformed varint — stop
      offset = value.next;
      fields.push({ fieldNumber, wireType, value: value.value });
    } else if (wireType === 2) {
      // length-delimited
      const length = readVarintOrBail(offset);
      if (!length) return fields; // malformed varint — stop
      offset = length.next;
      const end = offset + length.value;
      if (end > bytes.length) return fields; // truncated — bail
      fields.push({ fieldNumber, wireType, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wireType === 5) {
      offset += 4; // 32-bit
    } else if (wireType === 1) {
      offset += 8; // 64-bit
    } else {
      return fields; // unknown wire type — stop
    }
  }
  return fields;
}

function readProtoVarint(bytes: Uint8Array, start: number): { value: number; next: number } {
  let offset = start;
  let shift = 0;
  let value = 0;
  while (offset < bytes.length) {
    const byte = bytes[offset]!;
    value += (byte & 0x7f) * 2 ** shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7;
    if (shift > 56) break; // overflow guard
  }
  throw new Error("PROTOBUF_PARSE_ERROR");
}

// ----- byte / base64url / base32 helpers (no dependencies) -----

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
  return output;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]!;
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]!;
  return output;
}

/** Decode-check that the normalized secret yields at least one byte. */
function isValidBase32(secret: string): boolean {
  try {
    return decodeBase32(secret).length > 0;
  } catch {
    return false;
  }
}

function decodeBase32(secret: string): Uint8Array {
  if (!isBase32Secret(secret)) throw new Error("Invalid Base32 secret");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of secret) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error("Invalid Base32 character");
    value = value * 32 + idx;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      const divisor = 2 ** bits;
      bytes.push(Math.floor(value / divisor) & 0xff);
      value %= divisor;
    }
  }
  if (bytes.length === 0) throw new Error("Empty secret");
  return new Uint8Array(bytes);
}
