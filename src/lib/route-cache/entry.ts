// Cache entries, written as JSON: bodies travel base64-encoded (`/favicon.ico` is bytes) and headers as
// pairs. Keys are the router's path plus a normalized query; see docs/sanity/revalidation-and-caching.md

import type { CacheOptions } from "astro";
import { decodeRequestPath } from "~/features/auth/canonical-path";

/** Store entries are size-capped; skip an unusually large body rather than fail the write. */
export const ENTRY_MAX_BYTES = 1_000_000;

export type RouteCacheEntry = {
  status: number;
  headers: [string, string][];
  body: string;
};

// Campaign and referral parameters never change content; without this every ?utm_source is its own entry.
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "_ke",
  "oly_anon_id",
  "oly_enc_id",
  "rb_clickid",
  "s_cid",
  "vero_id",
  "wickedid",
  "yclid",
  "__s",
  "ref",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();

  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/** Query params each route reads; a new one goes here, or requests carrying it are never stored. */
export const ROUTE_QUERY_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "/blog": ["category"],
};

/** Past these a request still renders, it is just not stored, so no query can mint an oversized key. */
const MAX_QUERY_PAIRS = 16;
const MAX_QUERY_VALUE_LENGTH = 100;

/** The route's own params, deduped and sorted, minus tracking ones; null (not stored) for any other. */
export function entryQuery(path: string, params: URLSearchParams): string | null {
  const allowed = ROUTE_QUERY_PARAMS[path] ?? [];
  const pairs: [string, string][] = [];

  for (const name of [...new Set(params.keys())].sort()) {
    if (isTrackingParam(name)) {
      continue;
    }

    // Refused, not dropped: a route that starts reading it must never get an entry keyed without it.
    if (!allowed.includes(name)) {
      return null;
    }

    for (const value of [...new Set(params.getAll(name))].sort()) {
      if (value.length > MAX_QUERY_VALUE_LENGTH) {
        return null;
      }

      pairs.push([name, value]);
    }
  }

  return pairs.length > MAX_QUERY_PAIRS ? null : new URLSearchParams(pairs).toString();
}

/** The path the router renders plus the normalized query; null for a request that must not be cached at all. */
export function entryKey(url: URL): string | null {
  const path = decodeRequestPath(url.pathname);

  if (path === null) {
    return null;
  }

  const query = entryQuery(path, url.searchParams);

  if (query === null) {
    return null;
  }

  return `astro-route:${path}${query ? `?${query}` : ""}`;
}

// Astro turns `Astro.cookies` writes into Set-Cookie only after this provider returns, so read them off the response.
const ASTRO_COOKIES = Symbol.for("astro.cookies");

function setsCookies(response: Response): boolean {
  if (response.headers.has("set-cookie")) {
    return true;
  }

  const cookies: unknown = Reflect.get(response, ASTRO_COOKIES);

  if (typeof cookies !== "object" || cookies === null || !("headers" in cookies) || typeof cookies.headers !== "function") {
    return false;
  }

  return !(cookies.headers() as Iterator<string>).next().done;
}

/** Null when it must not be stored: only a plain 200 that sets no cookie, with a lifetime the route asked for, is an entry. */
export function entryTtl(response: Response, options: CacheOptions | undefined): number | null {
  if (response.status !== 200 || setsCookies(response)) {
    return null;
  }

  const maxAge = options?.maxAge ?? 0;

  return maxAge > 0 ? maxAge : null;
}

// Web-standard base64, no `Buffer`: this is bundled into SSR output. Chunked so a page body cannot overflow the argument list.
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function toEntry(response: Response): Promise<RouteCacheEntry | null> {
  const body = new Uint8Array(await response.arrayBuffer());

  if (body.byteLength > ENTRY_MAX_BYTES) {
    return null;
  }

  const headers: [string, string][] = [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      headers.push([key, value]);
    }
  });

  return { status: response.status, headers, body: bytesToBase64(body) };
}

export function toResponse(entry: RouteCacheEntry): Response {
  return new Response(base64ToBytes(entry.body), {
    status: entry.status,
    headers: new Headers(entry.headers),
  });
}
