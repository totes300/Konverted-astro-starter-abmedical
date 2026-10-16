import type { APIRoute } from "astro";
import { handleCachePurge } from "~/features/api/cache-purge";
import { apiErrorResponse } from "~/features/api/errors";
import { contentVersion } from "~/lib/content-version";
import { SANITY_REVALIDATE_SECRET } from "~/lib/env";
import { ROUTE_CACHE_ALL_TAG } from "~/lib/route-cache/create-provider";

// Escape hatch: empties the whole route cache (every instance on Vercel, only the receiving one on the in-process store).
// Reuses SANITY_REVALIDATE_SECRET as a Bearer token: both endpoints bust cache, so it grants nothing new.
export const prerender = false;

export const POST: APIRoute = async ({ request, cache }) => {
  const secret = SANITY_REVALIDATE_SECRET?.trim();

  if (!secret) {
    return apiErrorResponse(503, { error: "Cache purge is unavailable.", code: "unavailable" });
  }

  return handleCachePurge(request, {
    secret,
    bumpContentVersion: () => contentVersion.bump(),
    invalidateAll: () => cache.invalidate({ tags: [ROUTE_CACHE_ALL_TAG] }),
  });
};
