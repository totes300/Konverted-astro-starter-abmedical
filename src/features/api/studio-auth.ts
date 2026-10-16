// Gate for Studio-backed API routes: Sanity must confirm a signed-in person with publish access to this project.
// Framework-free (Web Crypto and fetch only). Threat model and the rules: docs/features/studio-api-auth.md
import { apiErrorResponse } from "./errors";

// The Access API is versioned on its own and does not exist at older content API versions (404), so it
// cannot follow the project's `*_SANITY_API_VERSION`: this pins the documented Access API contract.
const ACCESS_API_VERSION = "v2025-07-11";
const MAX_PERMISSION_PAGES = 5;
// Not in Sanity's reference docs: `/users/me` reports this `provider` for API (robot) tokens. Used only to
// refuse robots; the allow decision never depends on it.
const ROBOT_PROVIDER = "sanity-token";
const VERIFY_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
const NEGATIVE_CACHE_MAX_ENTRIES = 100;
// RFC 6750 `b64token`, capped well above any Sanity token, so junk never reaches Sanity or the cache.
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
const MAX_BEARER_TOKEN_LENGTH = 512;

type Verdict = "allowed" | "forbidden" | "unauthenticated";

export type StudioAuthConfig = {
  projectId: string;
  /** The project's Sanity API version, from its env (`*_SANITY_API_VERSION`), with or without a leading `v`. */
  apiVersion: string;
};

type VerdictCache = Map<string, { verdict: Verdict; expiresAt: number }>;

// Keyed by a hash of the token, so a Studio session costs one Sanity round trip a minute, not one per
// call. A removed editor keeps access for at most CACHE_TTL_MS.
const allowedCache: VerdictCache = new Map();
// Apart, so a flood of rejected tokens evicts only other rejections, never an editor's verdict.
const deniedCache: VerdictCache = new Map();

async function hashKey(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bearerToken(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec((request.headers.get("authorization") ?? "").trim());
  const token = match?.[1] ?? "";

  return token.length <= MAX_BEARER_TOKEN_LENGTH && BEARER_TOKEN.test(token) ? token : null;
}

function cachedVerdict(key: string) {
  for (const cache of [allowedCache, deniedCache]) {
    const entry = cache.get(key);

    if (!entry) {
      continue;
    }

    if (entry.expiresAt < Date.now()) {
      cache.delete(key);
      continue;
    }

    return entry.verdict;
  }

  return null;
}

function cacheVerdict(key: string, verdict: Verdict) {
  const cache = verdict === "allowed" ? allowedCache : deniedCache;
  const maxEntries = verdict === "allowed" ? CACHE_MAX_ENTRIES : NEGATIVE_CACHE_MAX_ENTRIES;

  if (cache.size >= maxEntries) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  cache.set(key, { verdict, expiresAt: Date.now() + CACHE_TTL_MS });
}

function sanityGet(url: string, token: string) {
  return fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });
}

export type AccessPermission = {
  type?: unknown;
  action?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
  params?: { mode?: unknown } | null;
};

/** Publish access to content: the built-in administrator, editor and developer roles grant
 *  `sanity.document.filter.mode` in `publish` mode; custom roles may grant `sanity.document.filter` update. */
export function grantsPublish(permission: AccessPermission, projectId: string) {
  const onThisProject = permission.resourceType === "project" && permission.resourceId === projectId;
  // Tolerates a publish-mode grant without resource fields, so editors are never locked out by a payload change.
  const unscoped = permission.resourceType === undefined && permission.resourceId === undefined;

  if (permission.type === "sanity.document.filter.mode" && permission.params?.mode === "publish") {
    return onThisProject || unscoped;
  }

  return permission.type === "sanity.document.filter" && permission.action === "update" && onThisProject;
}

/** Documented Access API: every permission this token holds on the project, paginated. */
async function publishAccess(token: string, projectId: string): Promise<Verdict> {
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PERMISSION_PAGES; page++) {
    const url = new URL(`https://api.sanity.io/${ACCESS_API_VERSION}/access/project/${projectId}/user-permissions/me`);
    url.searchParams.set("limit", "100");

    if (cursor) {
      url.searchParams.set("nextCursor", cursor);
    }

    const response = await sanityGet(url.toString(), token);

    if (response.status === 401) {
      return "unauthenticated";
    }

    if (response.status === 403) {
      return "forbidden";
    }

    if (!response.ok) {
      throw new Error(`Sanity answered ${response.status} while reading Studio permissions.`);
    }

    const body = (await response.json()) as { data?: AccessPermission[] | null; nextCursor?: string | null };

    if ((body.data ?? []).some((permission) => grantsPublish(permission, projectId))) {
      return "allowed";
    }

    cursor = body.nextCursor ?? null;

    if (!cursor) {
      return "forbidden";
    }
  }

  return "forbidden";
}

/** Refuses API (robot) tokens, which the Access API treats like people. `/users/me` requires a valid session. */
async function sessionKind(
  token: string,
  { projectId, apiVersion }: StudioAuthConfig
): Promise<"person" | "robot" | "unauthenticated"> {
  const response = await sanityGet(`https://${projectId}.api.sanity.io/v${apiVersion.replace(/^v/, "")}/users/me`, token);

  if (response.status === 401 || response.status === 403) {
    return "unauthenticated";
  }

  if (!response.ok) {
    throw new Error(`Sanity answered ${response.status} while verifying a Studio session.`);
  }

  const user = (await response.json()) as { id?: unknown; provider?: unknown };

  if (typeof user.id !== "string" || !user.id) {
    return "unauthenticated";
  }

  return user.provider === ROBOT_PROVIDER ? "robot" : "person";
}

/** Both checks in parallel. Throws on a network failure or an unexpected status, so an outage fails
 *  closed without being cached. */
async function verifyToken(token: string, config: StudioAuthConfig): Promise<Verdict> {
  const [kind, access] = await Promise.all([sessionKind(token, config), publishAccess(token, config.projectId)]);

  if (kind === "unauthenticated" || access === "unauthenticated") {
    return "unauthenticated";
  }

  if (kind === "robot") {
    return "forbidden";
  }

  return access;
}

async function studioVerdict(request: Request, config: StudioAuthConfig): Promise<Verdict> {
  const token = bearerToken(request);

  if (!token) {
    return "unauthenticated";
  }

  const key = await hashKey(`${config.projectId}:${token}`);
  const cached = cachedVerdict(key);

  if (cached) {
    return cached;
  }

  const verdict = await verifyToken(token, config);
  cacheVerdict(key, verdict);
  return verdict;
}

/**
 * Resolves to `null` when the request may proceed, or to the error `Response` to return. Call it first
 * in every Studio-backed handler:
 *
 *   const denied = await authorizeStudioRequest(request);
 *   if (denied) { return denied; }
 *
 * Studio code sends the token with `studioFetch` / `useStudioFetch` (`sanity/lib/studio-fetch.ts`).
 */
export async function authorizeStudioRequest(request: Request, config: StudioAuthConfig): Promise<Response | null> {
  let verdict: Verdict;

  try {
    verdict = await studioVerdict(request, config);
  } catch (error) {
    // So a lasting 503 can be traced; these errors carry a status or a network code, never the token.
    console.error("[studio-auth] Sanity did not answer the Studio session check:", error);

    return apiErrorResponse(503, {
      error: "Could not verify the Studio session.",
      code: "auth_unavailable",
      hint: "Sanity did not answer the session check. Try again in a moment.",
    });
  }

  if (verdict === "allowed") {
    return null;
  }

  if (verdict === "forbidden") {
    return apiErrorResponse(403, {
      error: "Forbidden.",
      code: "forbidden",
      hint: "Only a signed-in Studio user with publish access to this project can call this route.",
    });
  }

  return apiErrorResponse(401, {
    error: "Unauthorized.",
    code: "unauthorized",
    hint: "These routes back the Studio. Sign in to the Studio and call them from there.",
  });
}
