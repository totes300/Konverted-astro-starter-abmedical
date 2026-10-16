import type { APIRoute } from "astro";
import { isSiteLocked } from "~/features/auth/sanity-basic-auth-proxy";
import { isSectionPreviewPath } from "~/features/page-builder/section-preview-path";
import { CACHE_TTL, cacheResponse, SITE_WIDE_CACHE_TAGS } from "~/lib/cache";
import { absoluteUrl } from "~/lib/env";
import { renderSitemap } from "~/lib/sitemap";
import type { SitemapQResult } from "~/sanity/types";
import { loadQuery } from "../sanity/lib/load-query";
import { SitemapQ } from "../sanity/queries";

const XML_HEADERS = { "content-type": "application/xml; charset=utf-8" };

// CMS-driven sitemap: every routed document that is not noindex or password protected.
export const GET: APIRoute = async (context) => {
  // A locked site lists no pages, and an unreadable state counts as locked; neither answer is cached.
  if (await isSiteLocked()) {
    return new Response(renderSitemap([]), { headers: XML_HEADERS });
  }

  // Any routed document's publish changes the sitemap, so it carries every routed _type.
  cacheResponse(context, { ...CACHE_TTL, tags: ["page", "legalPage", "article", "person", "blog", ...SITE_WIDE_CACHE_TAGS] });

  const { data: entries } = await loadQuery<SitemapQResult>({ query: SitemapQ });

  const urls = (entries ?? [])
    // The specimen's prefix is reserved and always gated, so a CMS page given a URL under it is never public.
    .filter((entry) => entry.uri && !isSectionPreviewPath(entry.uri))
    .map((entry) => ({ loc: absoluteUrl(entry.uri), lastmod: entry.updatedAt }));

  return new Response(renderSitemap(urls), { headers: XML_HEADERS });
};
