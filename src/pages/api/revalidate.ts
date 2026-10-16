import type { APIRoute } from "astro";
import { apiErrorResponse } from "~/features/api/errors";
import { CONTENT_LAKE_SETTLE_MS, handleRevalidateDelivery } from "~/features/api/revalidate";
import { contentVersion } from "~/lib/content-version";
import { SANITY_REVALIDATE_SECRET } from "~/lib/env";

// Sanity publish webhook to cache invalidation, projection `{_id, _type, "uri": uri.current}`.
// A document busts its own routes and its `_type` tag; publishing `site` busts every page.
export const prerender = false;

export const POST: APIRoute = async ({ request, cache }) => {
  const secret = SANITY_REVALIDATE_SECRET?.trim();

  if (!secret) {
    return apiErrorResponse(503, { error: "Revalidation is unavailable.", code: "unavailable" });
  }

  return handleRevalidateDelivery(request, {
    secret,
    settle: () => new Promise((resolve) => setTimeout(resolve, CONTENT_LAKE_SETTLE_MS)),
    bumpContentVersion: () => contentVersion.bump(),
    invalidateTags: (tags) => cache.invalidate({ tags }),
  });
};
