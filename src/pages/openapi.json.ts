import type { APIRoute } from "astro";
import { SiteLockedQuery } from "~/features/agents/query";
import { apiErrorResponse } from "~/features/api/errors";
import { buildOpenApiDocument } from "~/features/api/openapi";
import { SiteQuery } from "~/features/site/query";
import { CACHE_TTL, cacheResponse, SITE_WIDE_CACHE_TAGS } from "~/lib/cache";
import { PUBLIC_SITE_URL } from "~/lib/env";
import type { SiteLockedQueryResult, SiteQueryResult } from "~/sanity/types";
import { loadQuery } from "../sanity/lib/load-query";

/** Serves the OpenAPI description of the public machine surface; name and description come from the Site singleton. */
export const GET: APIRoute = async ({ cache, locals }) => {
  cacheResponse({ cache, locals }, { ...CACHE_TTL, tags: [...SITE_WIDE_CACHE_TAGS] });

  const [{ data: site }, { data: isSiteLocked }] = await Promise.all([
    loadQuery<SiteQueryResult>({ query: SiteQuery }),
    loadQuery<SiteLockedQueryResult>({ query: SiteLockedQuery }),
  ]);

  // It names the site and points at its index, so it goes dark with the pages while the whole site is behind Basic Auth.
  if (isSiteLocked) {
    return apiErrorResponse(404, { error: "Not found.", code: "not_found" });
  }

  const document = buildOpenApiDocument({
    baseUrl: PUBLIC_SITE_URL,
    siteName: site?.name ?? undefined,
    description: site?.seoMetadata?.description ?? undefined,
  });

  return Response.json(document);
};
