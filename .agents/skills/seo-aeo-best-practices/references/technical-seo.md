# Technical SEO Checklist

Essential technical SEO elements for modern web applications.

## Table of Contents

- Metadata
- Sitemaps
- Canonical URLs
- Redirects
- Performance
- Robots.txt
- International SEO

## Metadata

### Title Tags

- Unique per page
- 50-60 characters
- Primary keyword near the beginning
- Brand name at the end (optional)

### Meta Descriptions

- Unique per page
- 150-160 characters
- Include call-to-action
- Contain relevant keywords

### Open Graph

```html
<meta property="og:title" content="Page Title" />
<meta property="og:description" content="Description" />
<meta property="og:image" content="https://example.com/image.jpg" />
<meta property="og:url" content="https://example.com/page" />
<meta property="og:type" content="article" />
```

### How this repo does it

Meta lives in one place: `src/layouts/Web.astro` renders every tag from its typed `Props`, and pages pass those props in the frontmatter. `seo()` in `src/sanity/seo.ts` merges a document's `seoMetadata` with the `site` singleton's defaults, so a page only supplies what it overrides (it also runs `getOgImageSrc`, which crops the CMS image to 1200x630, and keeps only the social profile URLs `safeHref()` accepts for the Organization `sameAs`).

```astro
---
import Web from "~/layouts/Web.astro";
import { loadSite, seo } from "../sanity/seo";

// `loadSite` is separate from `seo` so the route fetches it alongside its own document query.
const [{ data: page }, { data: site }] = await Promise.all([loadQuery<PageQResult>({ query: PageQ, params: { uri } }), loadSite(Astro)]);

const { title, description, image, robots } = page.seoMetadata ?? {};
const seoProps = seo(site, { title, description, image, robots, canonical });
---

<Web {...seoProps}>
  <Fragment slot="head">
    <!-- per-page extras only; the standard tags are already in Web.astro -->
  </Fragment>
</Web>
```

Two things to keep right: strings that end up in meta tags must be stega-free (`stegaClean`) so invisible preview characters never reach a crawler, and a page's `noindex` has to reach the `robots` prop rather than being handled at the template level.

## Sitemaps

`src/pages/sitemap.xml.ts` is a CMS-driven endpoint: one GROQ query (`SitemapQ`) returns every routed document that is not noindex or password protected, and `renderSitemap()` (`src/lib/sitemap.ts`) serializes it, escaping each value with `escapeXml` (`src/lib/xml.ts`) so a URI such as `/q&a` cannot invalidate the document. The route is exempt from Basic Auth, so while the whole site is locked it lists no pages; an unreadable lock state counts as locked, and neither answer is cached. Otherwise it is cached with every routed `_type` plus `SITE_WIDE_CACHE_TAGS`, so a publish invalidates it through `/api/revalidate`. Tags are set through `cacheResponse` (`src/lib/cache.ts`), never `cache.set`.

```ts
export const GET: APIRoute = async (context) => {
  // A locked site lists no pages, and an unreadable state counts as locked; neither answer is cached.
  if (await isSiteLocked()) {
    return new Response(renderSitemap([]), { headers: XML_HEADERS });
  }

  cacheResponse(context, { ...CACHE_TTL, tags: ["page", "legalPage", "article", "person", "blog", ...SITE_WIDE_CACHE_TAGS] });

  const { data: entries } = await loadQuery<SitemapQResult>({ query: SitemapQ });
  // ...map each entry to { loc: absoluteUrl(entry.uri), lastmod: entry.updatedAt } and renderSitemap() them
};
```

Google ignores `<changefreq>` and `<priority>`, so entries carry only the URL and a content-driven `lastmod`. A new routed document type means adding it to `SitemapQ` and to the cache tags.

## Canonical URLs

Prevent duplicate content issues. The canonical is built with `absoluteUrl` (from `~/lib/env`, the one seam that joins the canonical origin to a path) and passed to `Web.astro` as a prop:

```ts
const canonical = absoluteUrl(uri);
```

Because the pages model stores a full `uri` per document, the canonical is always derivable from the document, never from the request URL (which can carry query strings or a preview path).

## Redirects

CMS-managed redirects live on the `siteSettings` document (read by `_id`) and are fetched once at config load, filtered by `toConfigRedirects()` (`scripts/build/cms-redirects.mjs`), then handed to Astro's `redirects` config:

```js
// astro.config.mjs
export default defineConfig({
  redirects: await fetchRedirects(),
});
```

The fetch is fail-soft: a fresh clone with no env (or an unreachable Sanity) builds with no redirects instead of crashing. Only exact same-site paths pass the filter (a destination may add a plain query, a section anchor, or be an `https` URL on the site's apex or `www`); a source under `/api`, the Studio path or `/_`, a pattern, a `%` escape in the source, or a destination that loops back is dropped and logged rather than failing the deploy, and the Studio's **From** and **To** fields refuse every entry the build would drop. Because they are baked in at build time, a redirect added in the Studio needs a redeploy. See `docs/features/redirects.md`.

## Performance

[Core Web Vitals](https://web.dev/articles/defining-core-web-vitals-thresholds) impact rankings:

- **LCP (Largest Contentful Paint):** < 2.5s
- **INP (Interaction to Next Paint):** < 200ms
- **CLS (Cumulative Layout Shift):** < 0.1

### Image optimization

- Render `SanityMedia.astro` (or `SanityImage.astro` directly); it builds a responsive `srcset` through `src/features/sanity/media/image/utils.ts` and never upscales.
- The URL builder requests `auto=format`, so Sanity's CDN serves WebP/AVIF where supported.
- LQIP is in the image fragment; `SanityImage.astro` paints it behind the `<img>` through `getLqipStyle` (skipped for images with transparency, and for any value that is not a base64 image data URI, via `safeLqip()`), and its `sanity-image` element (`SanityImageElement.ts`) removes it once the image loads.
- Dimensions come from the asset metadata, so images reserve their box and do not shift layout.

### Font loading

Geist is self-hosted (`@fontsource-variable` plus the pixel faces in `public/fonts/geist-pixel/`) and every `@font-face` declares `font-display: swap`. Nothing is fetched from a third-party font host, so there is no extra connection on the critical path.

## Robots.txt

`src/pages/robots.txt.ts` renders it through `renderRobotsTxt()` (`src/features/agents/ai-crawlers.ts`). The Studio path is `PUBLIC_SANITY_STUDIO_BASE_PATH` without a trailing slash, because `Disallow` is a prefix match and `/studio/` would miss the bare route. With the default env the route emits:

```
# Search and citation are welcome. Training is not.
# Declared in the codebase so the policy travels with the site, not with the host.

User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
Disallow: /api/
Disallow: /studio

User-agent: CCBot
User-agent: ChatGPT-User
User-agent: Claude-SearchBot
User-agent: Claude-User
User-agent: ClaudeBot
User-agent: OAI-SearchBot
User-agent: Perplexity-User
User-agent: PerplexityBot
Allow: /
Disallow: /api/
Disallow: /studio

User-agent: Amazonbot
User-agent: Applebot-Extended
User-agent: Bytespider
User-agent: GPTBot
User-agent: Google-Extended
User-agent: meta-externalagent
Disallow: /

Sitemap: https://example.com/sitemap.xml
```

**AI crawler policy:** search and citation yes, training no. The citation crawlers (`AI_CITATION_CRAWLERS`) get their own group because a crawler obeys only its most specific group, so each named group repeats the site's own disallows. The training crawlers (`AI_TRAINING_CRAWLERS`) are blocked, which costs no search visibility: `Google-Extended` never governs Search or AI Overviews. To change the policy, edit those arrays and `CONTENT_SIGNAL`, not the route.

## International SEO (hreflang)

For multi-language sites, implement hreflang tags to indicate language/region variants:

This repo is single-locale today: there is no `lang` route segment and no hreflang output. If you add locales, emit the alternates from the `head` slot of `Web.astro` so every variant (plus `x-default`) ships on every page:

```astro
<Fragment slot="head">
  <link rel="alternate" hreflang="en" href={absoluteUrl(`/en${path}`)} />
  <link rel="alternate" hreflang="de" href={absoluteUrl(`/de${path}`)} />
  <link rel="alternate" hreflang="x-default" href={absoluteUrl(`/en${path}`)} />
</Fragment>
```

Include all language variants in sitemaps with `hreflang` annotations for proper indexing.
