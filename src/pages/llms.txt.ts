import type { APIRoute } from "astro";
import { dropGatedLinks } from "~/features/agents/gated-links";
import { LlmsTxtServeQuery, SiteLockedQuery } from "~/features/agents/query";
import { canonicalUri } from "~/features/auth/canonical-path";
import { CACHE_TTL, cacheResponse, SITE_WIDE_CACHE_TAGS } from "~/lib/cache";
import { PUBLIC_SITE_URL } from "~/lib/env";
import type { LlmsTxtServeQueryResult, SiteLockedQueryResult } from "~/sanity/types";
import { loadQuery } from "../sanity/lib/load-query";

// Serves the published llms.txt content managed in the Settings singleton (generated in the Studio).
export const GET: APIRoute = async ({ cache, locals }) => {
  // Settings holds the file and the site lock; any routed document's publish can gate a page the file links.
  cacheResponse(
    { cache, locals },
    { ...CACHE_TTL, tags: ["page", "legalPage", "article", "person", "blog", ...SITE_WIDE_CACHE_TAGS] }
  );

  const [{ data }, { data: isSiteLocked }] = await Promise.all([
    loadQuery<LlmsTxtServeQueryResult>({ query: LlmsTxtServeQuery }),
    loadQuery<SiteLockedQueryResult>({ query: SiteLockedQuery }),
  ]);

  // The file indexes every page, so it goes dark with them while the whole site is behind Basic Auth.
  if (isSiteLocked || data?.enabled === false || !data?.content) {
    return new Response("Not found", { status: 404 });
  }

  const gatedPaths = new Set((data.gatedPaths ?? []).filter((path): path is string => Boolean(path)).map(canonicalUri));

  return new Response(dropGatedLinks(data.content, gatedPaths, PUBLIC_SITE_URL), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
