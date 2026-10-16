// The cache-purge endpoint after its secret check; the platform calls are injected so tests can order them.
// What it reaches and why it reuses the webhook secret: docs/sanity/revalidation-and-caching.md#clearing-the-whole-cache

import { apiErrorResponse, internalErrorResponse, privateJson } from "~/features/api/errors";
import { timingSafeEqual } from "~/features/auth/basic-auth";

export type PurgeSteps = {
  secret: string;
  bumpContentVersion: () => Promise<unknown>;
  invalidateAll: () => Promise<unknown>;
};

export async function handleCachePurge(request: Request, steps: PurgeSteps): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!timingSafeEqual(provided, steps.secret)) {
    return apiErrorResponse(401, {
      error: "Invalid secret.",
      code: "invalid_secret",
      hint: "Send SANITY_REVALIDATE_SECRET as a Bearer token.",
    });
  }

  try {
    // A suspect cache is re-rendered from origin, not from whatever the CDN holds under the old version.
    await steps.bumpContentVersion();
    await steps.invalidateAll();
  } catch (err) {
    return internalErrorResponse(err, {
      error: "Cache purge failed.",
      code: "internal_error",
      hint: "Try again; a redeploy also empties the cache.",
    });
  }

  return privateJson({ purged: "all" });
}
