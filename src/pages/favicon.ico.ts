import type { APIRoute } from "astro";
import { SiteQuery } from "~/features/site/query";
import { FAVICON_MIME, FAVICON_ROUTE_PX, getFaviconImageSrc, resolveFaviconAsset } from "~/features/site/seo/favicon";
import { CACHE_TTL, cacheResponse, SITE_WIDE_CACHE_TAGS } from "~/lib/cache";
import type { SiteQueryResult } from "~/sanity/types";
import { loadQuery } from "../sanity/lib/load-query";

const UPSTREAM_TIMEOUT_MS = 5000;

/** An endpoint rather than a static file: the icon lives in the CMS and its CDN URL moves on every swap, so this path is the stable URL Google crawls. */
export const GET: APIRoute = async ({ cache, locals }) => {
  // The icon lives on Settings, so publishing that singleton is what invalidates it.
  cacheResponse({ cache, locals }, { ...CACHE_TTL, tags: [...SITE_WIDE_CACHE_TAGS] });

  const { data: site } = await loadQuery<SiteQueryResult>({ query: SiteQuery });
  const asset = resolveFaviconAsset(site?.favicon);

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  // Read whole inside the timeout, so a body that stalls after its headers still gets the 502.
  const icon = await fetch(getFaviconImageSrc(asset, FAVICON_ROUTE_PX), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
    .then((upstream) => (upstream.ok ? upstream.arrayBuffer() : null))
    .catch(() => null);

  if (!icon || icon.byteLength === 0) {
    return new Response(null, { status: 502 });
  }

  // Proxied rather than redirected: a 302 to the CDN would hand Google the unstable URL again.
  return new Response(icon, { headers: { "content-type": FAVICON_MIME } });
};
