// `__draft_session`: proof this browser passed the Presentation handshake, an HMAC-signed expiry.
// Framework-free (Web Crypto only). See docs/features/studio-api-auth.md.

export const DRAFT_SESSION_COOKIE = "__draft_session";
export const DRAFT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

/** Slack for clocks across serverless instances, never for a lifetime longer than the cookie's. */
const CLOCK_SKEW_SECONDS = 60;

/** Bump the version to invalidate every issued session at once. */
const KEY_LABEL = "draft-session:v2";

/** Any origin works: only the path a value resolves to is compared and returned. */
const PLACEHOLDER_ORIGIN = "https://draft-session.invalid";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HKDF-derived HMAC key, so the cookie is never keyed with the raw view token. */
async function signingKey(secret: string) {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(KEY_LABEL), info: encoder.encode(KEY_LABEL) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"]
  );
}

async function signature(secret: string, expiresAt: number) {
  const signed = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(String(expiresAt)));
  return toBase64Url(new Uint8Array(signed));
}

/** A cookie value that stays valid for DRAFT_SESSION_MAX_AGE_SECONDS. `secret` is a server-only value. */
export async function createDraftSession(secret: string, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + DRAFT_SESSION_MAX_AGE_SECONDS;
  return `${expiresAt}.${await signature(secret, expiresAt)}`;
}

/** True only for an unexpired value this server signed, expiring no later than a fresh one would. */
export async function verifyDraftSession(secret: string, value: string | null | undefined, now = Date.now()) {
  if (!secret || !value) {
    return false;
  }

  const [expiresRaw = "", provided, ...rest] = value.split(".");
  // One spelling per expiry: Number() also accepts " 17...", "017...", "0x..." and "1e9".
  const expiresAt = /^[1-9]\d{0,14}$/.test(expiresRaw) ? Number(expiresRaw) : Number.NaN;
  const nowSeconds = Math.floor(now / 1000);
  const latestExpiry = nowSeconds + DRAFT_SESSION_MAX_AGE_SECONDS + CLOCK_SKEW_SECONDS;

  if (rest.length > 0 || !provided || !Number.isSafeInteger(expiresAt) || expiresAt < nowSeconds || expiresAt > latestExpiry) {
    return false;
  }

  const expected = await signature(secret, expiresAt);

  if (expected.length !== provided.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }

  return diff === 0;
}

/** The shape `@sanity/preview-url-secret` generates (16 random bytes as hex, then base64url). */
export function hasPreviewSecretShape(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(value);
}

/** Control characters (stripped by the URL parser) and backslashes (read as `/`) can turn a path into `//host`. */
function hasUnsafeRedirectCharacter(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f || code === 0x5c) {
      return true;
    }
  }

  return false;
}

/** Resolves a `?redirectTo=`-style value to a URL on `origin`, else `origin/`. Never another host. */
export function safeRedirectUrl(value: string | null | undefined, origin: string) {
  const fallback = new URL("/", origin);

  if (!value?.startsWith("/") || hasUnsafeRedirectCharacter(value)) {
    return fallback;
  }

  try {
    const target = new URL(value, fallback);

    // A `//` pathname is a protocol-relative host again once a caller emits it as a relative path.
    if (target.origin !== fallback.origin || target.pathname.startsWith("//")) {
      return fallback;
    }

    return target;
  } catch {
    return fallback;
  }
}

/** `safeRedirectUrl` as an origin-relative path (`/path?query#hash`), for APIs that take a path. */
export function safeRedirectPath(value: string | null | undefined, origin = PLACEHOLDER_ORIGIN) {
  const { pathname, search, hash } = safeRedirectUrl(value, origin);
  return `${pathname}${search}${hash}`;
}
