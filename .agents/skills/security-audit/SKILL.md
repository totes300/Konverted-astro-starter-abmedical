---
name: security-audit
description: Use when auditing, hardening or reviewing the security of this Astro SSR site on Vercel, before a launch, after adding an endpoint under src/pages/api, a middleware branch, a route cache rule, a gate, a webhook, a third-party API, a CMS field the code renders or consumes, or a secret, when an Astro, Vercel adapter or Sanity advisory lands, or for a yearly audit. Playbook written from the security pass on this repo and checked against its code; covers the audit method and safe live testing, the middleware gate and its one canonical path, the route cache that answers before the middleware, draft mode, redirects, endpoints and abuse, the contact form and email, CMS tokens and data, webhooks, CMS values rendered into attributes, response headers and the Report-Only CSP, astro:env secrets, the Vercel firewall baseline, DNS, dependency triage, operator scripts, and the false positives to ignore. Do NOT use as the primary skill for performance (performance-audit), SEO (seo-aeo-best-practices) or endpoint conventions (server).
---

# Security audit (Astro on Vercel playbook)

Written from the security pass that hardened this repo (Astro SSR on `@astrojs/vercel`, a custom route cache, the embedded Sanity Studio, Resend, Umami, Mux) and checked file by file against its code. Repo files are named so you can check them; where a behavior comes from Astro or the adapter, the file under `node_modules` is named, because an upgrade can change it.

Most of what the pass fixed came from three habits:

1. **Something answered before the gate.** The route cache wraps the middleware; `/api/*` endpoints, file routes and config redirects never meet it; second spellings of a page (`/about.html`, `/%61bout`, an NFD path) render the page while a raw-path check misses them.
2. **A CMS string was trusted where the code consumes it.** Astro escapes attribute values but does not neutralize a `javascript:` href or a CSS value, and Studio validation never runs on API writes.
3. **An anonymous endpoint spent quota-limited credentials with no limit in code.** One contact form post is a Sanity write with the edit token plus one email per recipient.

## Core Rules

- **Gate in depth.** The middleware is one layer. The route cache, every endpoint that serves page content (agent Markdown, llms.txt, OpenAPI, sitemap, feed) and every form endpoint repeats the eligibility check. Listings filter gated items too.
- **Canonicalize once, decide once.** `canonicalRequestPath()` turns a request into the page it renders, and the gate decides on it. The alias 404 and the route cache key use `decodeRequestPath()`, the path the router renders. The route cache asks the gate with `canonicalRequestPath()`. Exemption is decided by the matched route (`context.routePattern`), never by the spelling.
- **Fail stale, not open; the cache fails closed.** A failed state read serves the last known state for a bounded time, then 503. The route cache serves and stores nothing public while the state is unknown.
- **Every endpoint is public.** `src/pages/api/*` is outside the middleware gate by design, and `security.checkOrigin` only stops browsers posting cross-site forms. Validate every field on the server, with caps, every time.
- **Never trust what a client can set.** `Origin`, `Referer`, `Host`, `X-Forwarded-Host`, `Sec-Fetch-*`, plain cookies (the perspective cookie, an unverified `__draft_session`) and timings the client sends prove nothing.
- **Astro escapes, it does not sanitize.** A CMS value that reaches `href`, `src` or `style` goes through an allowlist at the sink: `safeHref()`, the GROQ link filter, colors resolved to a palette token or a strict hex, `cssAspectRatio()` and `safeLqip()`.
- **Resolve URLs, never prefix-check them.** `new URL(value, origin)` and compare origins. Browsers strip tab, CR and LF and read `\` as `/`.
- **Cheap checks before expensive ones.** Shape, size and cached lookups run before a Sanity read, a write or a paid API. Every upstream call on a gate or form path, the Studio session check and the screenshot route carry their own timeout, and page reads through `loadQuery()` and the agent Markdown content read share the read client's 10 s one; the generation routes' edit-client calls are bounded only by the 60 s function cap (5.2).
- **Least privilege per secret.** Secrets come only from `astro:env/server`; one token per purpose; Production-only unless Preview truly needs them.
- **CMS validation is UI only.** Hrefs, colors, redirects, mail headers, recipients and URIs are validated where the code consumes them, because API writes skip the Studio.
- **Docs are attack surface.** A doc that promises a protection the code lacks is a finding; fix both in the same change.
- **Prove fixes with the exploit inputs.** Every fix ships with a test using the exact bypass input (`/x.html`, `/%78.html`, `/a%2Fb`, `/u%CC%88ber-uns`, `/%09/evil.example`, `java\tscript:x`, the color injection string). Pure helpers get the decoded value (`/\t/x`); request-path inputs stay encoded (`/%09/evil.example`).

## Trigger Conditions

Apply when:

- Launching, or before turning on Basic Auth, draft previews or a new form for real users.
- Adding or changing an endpoint in `src/pages/api/`, a branch in `src/middleware.ts`, a route cache rule, a page that sets its cache, a webhook, a CMS field rendered into an attribute, header or config, a third-party script or SDK, an env var or token.
- Changing `astro.config.mjs` (`redirects`, `image`, `security`, `env.schema`, `cache`, adapter options).
- An advisory or a major upgrade for Astro, `@astrojs/vercel` or `@sanity/*` (pipeline order, path decoding and `.html` stripping live in Astro's code).
- Yearly, as a full audit.

Not for: performance (`performance-audit`), SEO (`seo-aeo-best-practices`), endpoint conventions (`server`), or code style.

## Where it lives in this starter

| Surface | Files |
| --- | --- |
| Middleware gate, one path per page | `src/middleware.ts`, `src/features/auth/request-gate.ts`, `src/features/auth/canonical-path.ts`, `src/features/auth/excluded-paths.ts`, `src/features/auth/exempt-route.ts`, `src/features/auth/gates.ts`, `src/features/auth/basic-auth.ts`, `src/features/auth/basic-auth-state.ts`, `src/features/auth/sanity-basic-auth-proxy.ts`, `src/features/sanity/proxy-state.ts`, `sanity/schemas/fields/uri-gate.ts`, `sanity/schemas/fields/create-uri-field.tsx` (the routes a URI may not claim); tests beside each pure module (`request-gate`, `canonical-path`, `excluded-paths`, `exempt-route`, `basic-auth`, `basic-auth-state`, `proxy-state`, `uri-gate`); `middleware.ts`, `gates.ts` and `sanity-basic-auth-proxy.ts` are untested glue |
| Route cache | `src/lib/route-cache/provider.ts`, `create-provider.ts`, `rules.ts`, `entry.ts` (`ROUTE_QUERY_PARAMS`), `store.ts`, `vercel-store.ts`, `build-partition.ts`, `content-version.ts`; `src/lib/cache.ts` (`cacheResponse`), `src/lib/content-version.ts`, `src/features/blog/category-view.ts` |
| Draft mode | `src/pages/api/draft-mode/enable.ts`, `src/features/auth/preview-check.ts` (the handshake's failure answers), `src/pages/api/draft-mode/disable.ts`, `src/features/api/exact-path.ts`, `src/features/auth/draft-session.ts`, `src/sanity/lib/draft-mode.ts`, `sanity/actions.tsx` |
| Studio-backed endpoints | `src/features/api/studio-auth.ts`, `src/features/api/auth.ts`, `sanity/lib/studio-fetch.ts`, `sanity/lib/studio-response.ts` (reads an answer that may be a host's non-JSON 504), `src/pages/api/agents/*.ts`, `src/features/agents/alt-text.ts` (`isImageAssetId()`), `src/pages/api/seo-screenshot.ts`, `src/features/api/screenshot-checks.ts`, `src/features/api/errors.ts` |
| Content for agents and crawlers | `src/pages/api/agent-markdown/[...uri].ts`, `src/features/agents/markdown-eligibility.ts`, `markdown-proxy-state.ts`, `serve-agent-markdown.ts` (also the agent's 404, `notFoundRender()`), `markdown-rewrite.ts`, `markdown.ts` (`markdownHref()`), `query.ts`, `gated-links.ts`, `published-article-lists.ts`; `src/pages/llms.txt.ts`, `openapi.json.ts`, `sitemap.xml.ts`, `feed.xml.ts`; `src/lib/sitemap.ts` and `src/lib/xml.ts` (`escapeXml`) |
| Forms and email | `src/pages/api/contact-form.ts`, `src/features/forms/form-post.ts`, `src/features/forms/request-guard.ts`, `src/features/api/exact-path.ts`, `src/features/forms/response.ts`, `src/features/forms/form-element.ts` and `src/components/SubmitButton.astro` (the button shipped disabled), `src/features/page-builder/sections/ContactFormSection/validate-contact-form.ts`, `src/features/page-builder/sections/ContactFormSection/notification.ts`, `src/features/spam-prevention/utils.ts`, `src/sanity/lib/client.ts` (`sanityPublishedClient`, the read timeout) |
| CMS values in attributes | `src/features/sanity/link/safe-href.ts`, `src/features/sanity/link/fragment.ts`, `src/features/sanity/media/fragment.ts` and `utils.ts` (`cssAspectRatio`, `safeLqip`, `safeVideoSrc` for `SanityNativeVideo.astro`), the JSON-LD `sameAs` filter in `src/sanity/seo.ts`, `ArticleList.astro` and the author page, `src/features/sanity/link/SanityLink.astro`, `src/sanity/rich-text/components/Link.astro` (mapped for both `linkField` and the library's `link` mark, `mark-map.test.ts`), `src/sanity/media/SanityNativeVideo.astro`, the CTA, 404 and announcement links (`Cta.astro`, `SiteError.astro`, `SiteAnnouncement.astro`), `src/sanity/rich-text/components/token-color.ts`, `sanity/colors.ts`, `src/features/feed/html.ts`, `src/components/JsonLd.astro`; the Studio-side checks `sanity/schemas/fields/relative-href.ts` and `sanity/schemas/fields/app-color.tsx` |
| Webhooks | `src/pages/api/revalidate.ts`, `src/pages/api/cache-purge.ts` (their logic and tests in `src/features/api/revalidate.ts` and `cache-purge.ts`), `src/features/api/webhook-signature.ts` |
| Config, env, headers | `astro.config.mjs`, `scripts/build/cms-redirects.mjs` and its Studio twin `sanity/schemas/documents/redirect-path.ts`, `src/lib/env.ts`, `src/lib/security-headers.ts`, `docs/features/security-headers.md`, `.mcp.json`, `lefthook.yml` |
| Server-written ids | `sanity/constants.ts` (`apiOnlyDocumentId`), `sanity/api-only-documents.test.ts` |
| Operator scripts and seed | `scripts/sanity-project-setup/**`, `scripts/sanity-dataset/**`, `scripts/trim-features/**`, `scripts/section-thumbs/capture.ts`, `seed/**`, `.gitignore` (`/backups`, `*.tar.gz`) |

## Audit method

Run this for a launch or a yearly audit. For a single change, jump to the matching area.

1. **Recon (read-only, yourself).** Vercel project settings, env var names, types and targets (never values), firewall config, domains, DNS (SPF, DMARC, CAA), live headers, dataset visibility and CORS origins, `npm audit` with and without `--omit=dev`, and the routes the CDN answers before the function (`.vercel/output/config.json` after a build). Commands in section 12.
2. **Inventory.** Every route with how it is reached (page, `/api/` endpoint, file route, config redirect, injected `/_image`, `/_server-islands/[name]`, `/404`), its auth model, whether the route cache can answer it, and the paid API it calls. Every secret with where it is read, which environments get it and what a leak allows.
3. **Find.** One reviewer per surface: Studio auth, the gate and canonical path, the route cache, forms, rendering sinks, secrets and data exposure, headers, abuse and cost, infrastructure and supply chain. Each cites `file:line` and lists what it found safe.
4. **Verify adversarially.** A second reviewer tries to refute each finding from the cited code and its mitigations (`node_modules/astro/dist`, `node_modules/@astrojs/vercel/dist`, platform and SDK behavior). High severity gets two refuters with different angles. Expect about one claim in five to fail.
5. **Gap pass.** List what nobody reviewed (scripts, seed, Studio actions and inputs, schema validation, third-party scripts, injected routes) and assign follow-ups.
6. **Rate by realistic impact** on this deployment, not the theoretical worst case.
7. **Fix in file-disjoint workstreams**, each reviewed adversarially; then `npm test`, `npm run check`, `npm run build`, and the runtime checks in section 15.

### Safe live testing

Against production: GET and HEAD only, plus unauthenticated requests an auth or signature check must reject and that cannot write. A handful per endpoint, no loops, no load. Never submit the contact form, trigger email, CMS writes, AI generation or screenshots, never use the site's `.env` tokens against production APIs (your own CLI logins for section 12 are fine), and never print a secret (first four characters and length at most).

`astro dev` never gates (`IS_DEV` is `import.meta.env.DEV`; `npm run start` is `vercel dev`, which serves through the dev server too) and the Vercel adapter has no `astro preview`, so a gate or cache rule is proven only on a deployed build. A Preview deployment gates exactly like production. With Vercel Authentication on, tell the two 401s apart: the app's challenge is `WWW-Authenticate: Basic realm="Protected"`.

## 1. Edge gate (middleware, Basic Auth, one path per page)

The pipeline, in order (`node_modules/astro/dist/core/routing/handler.js`, `node_modules/astro/dist/core/middleware/load.js`):

1. The CDN answers `public/` files, `/_astro/*` and config redirects before the function runs.
2. In the function: the route is matched, then a path encoded more than ten levels deep answers 400 and trailing-slash handling runs, all before any middleware. A redirect route returns here, with no middleware.
3. The route cache provider's `onRequest`, which wraps everything below (section 2).
4. `security.checkOrigin`, placed ahead of the user middleware.
5. `src/middleware.ts`: `sequence(responseHeaders, draftSession, runtimeGates)`, then the page or endpoint.

### 1.1 A page route answers more than one spelling

Astro fully decodes the path before matching, strips `.html` and `/index.html` from page routes (`#stripHtmlExtension` in `node_modules/astro/dist/core/fetch/fetch-state.js`), and `[...uri]` matches anything. So `/secret.html`, `/%73ecret`, `/%2573ecret`, `/index.html` (the homepage) and the NFD spelling `/u%CC%88ber-uns` all render a page stored as `/secret` or `/über-uns`, and a gate comparing `context.url.pathname` as it arrives misses every one.

`src/features/auth/canonical-path.ts` decodes like the router, refuses what the router and a check could read apart, then strips the page suffixes and NFC-normalizes:

```ts
/** The path the router matches, or null for a spelling (`%2F`, `%25`, `\`, `..`) it and a gate could read apart. */
export function decodeRequestPath(pathname: string): string | null {
  const decoded = decodeFully(pathname);

  if (decoded === null || decoded.includes("%") || decoded.includes("\\") || DOT_SEGMENT.test(decoded)) {
    return null;
  }

  return normalizePathname(decoded.replace(/\/{2,}/g, "/"));
}

/** The page a request path gates as: `.html` and `/index.html` stripped the way the router strips them for pages. */
export function canonicalRequestPath(pathname: string): string | null {
  const path = decodeRequestPath(pathname);

  if (path === null) {
    return null;
  }

  return canonicalUri(path.replace(/\/index\.html$/, "/").replace(/\.html$/, ""));
}
```

`decodeURI` leaves reserved escapes encoded, so a `%` that survives the loop (`%2F`, `%3F`, `%23`) marks an ambiguous path, and a decoded `%25` that leaves a malformed escape makes the decode throw: either way `decodeRequestPath()` returns null and `/a%2Fb` answers 400. `canonicalUri()` gives stored `uri.current` values the same NFC and trailing-slash shape. `classifyRequest()` (`request-gate.ts`) then answers every file spelling of a page with 404 before the CMS gate (`isPageAliasSpelling`: `.html`, `.htm`, `/index`, encoded or not), so each page has one URL for the gate and the cache. Astro renders that 404 through the middleware on `routePattern === "/404"`, and that pass gates as the page the spelling names; for an agent's GET it renders the Markdown recovery map instead, inside the same gate (`notFoundRender()`). Astro keeps the first pass's 404 status when it merges the two (`mergeResponses` in `node_modules/astro/dist/core/errors/default-handler.js`), so a gated file spelling answers 404 with the challenge body and `WWW-Authenticate`, never the page or the map.

Inputs to keep in tests: `/x.html`, `/index.html`, `/index`, `/x%2Ehtml`, `/%78.html`, `/x.htm`, `/a%2Fb`, `/%2F/x`, `/a%252Fb`, `/a%25`, `/a%5Cb`, `/a/%2e%2e/b`, `/%E0%A4%A`, a path encoded 13 times, and every spelling of a Unicode URI (`/über-uns`, `/%C3%BCber-uns`, `/u%CC%88ber-uns`, `//%C3%BCber-uns/`, `/%25C3%25BCber-uns`).

### 1.2 Exempt by matched route, never by spelling

```ts
/** Pass `context.routePattern`, never the request path: `/x.html` is a page route's request, not a file route. */
export function isExcludedPath(routePattern: string, studioBasePath: string): boolean {
  if (isStudioPath(routePattern, studioBasePath)) {
    return true;
  }

  if (routePattern.startsWith("/api/")) {
    return true;
  }

  return isFileRoute(routePattern);
}
```

The request path gets both directions wrong: `/x.html` and `/secret.txt` look like files but route to the `[...uri]` page, and `/studio` on a page route is not the Studio. `/feed.xml` is the one file route kept gated (article bodies). `/api/<no handler>` matches the `[...uri]` page route, so it is gated as a page, and the 404 it renders on `/404` is gated again; so is every underscore route (Astro injects `/_server-islands/[name]` whenever an adapter is set, even with no islands in use), and `/_image` answers 404 before any of this (`classifyRequest()`, 5.4). A new endpoint or file route is exempt with no list to update, which is why 1.3 exists.

An exempt route that throws must not reach Astro's error render: with no `500.astro`, `renderDefaultError()` (`node_modules/astro/dist/core/errors/default-handler.js`) matches `/500` against the route table, which `[...uri]` answers, and runs the middleware again with that `routePattern`, so the gate answers a Basic challenge from `/api/draft-mode/enable` on a locked site. `runExemptRoute()` (`src/features/auth/exempt-route.ts`) wraps the exempt branch: a throw is logged and answered `503` with a body (Astro reroutes only a body-less 404 or 500, `REROUTABLE_STATUS_CODES`), `private, no-store` and `Retry-After: 10`, never a challenge. Routes with their own outage answer keep it (`enable.ts` answers a JSON `503 preview_unavailable` with `Retry-After: 10` when `validatePreviewUrl` cannot reach Sanity, section 3).

### 1.3 Exempt routes repeat the check

| Route | Could leak | Its own check |
| --- | --- | --- |
| `/api/agent-markdown/[...uri]`, and the `Accept: text/markdown` rewrite to it | A protected or `noIndex` page | Allowlist snapshot (`markdown-eligibility.ts`): only routes whose `excluded` flag is exactly `false` are served, so a missing route or an unevaluable flag is not; 404 when the state read throws; content read only after the check. The snapshot is tied to the content version (`markdown-proxy-state.ts`), so a published lock stops it on the next request, and `AgentMarkdownServeQuery` matches nothing while the settings singleton (by `_type` and `_id`) has the site lock |
| `/llms.txt` | The page inventory | 404 while Protect entire site is on, and links to pages gated since generation are dropped at serve time (`dropGatedLinks()`, read off each link's destination, so brackets in its text, a soft break, balanced parentheses in a raw URL (`/secret(1)`, the form the llms.txt generator writes), a reference definition (by its own destination, dropped with only its own lines), an autolink, a bare URL, the apex or `www` twin and either scheme cannot hide one) |
| `/openapi.json` | The page inventory | 404 while Protect entire site is on |
| `/sitemap.xml` | The page inventory | Empty `<urlset>` while locked or when the state is unreadable (`isSiteLocked()` fails closed), never cached; the query filters `passwordProtected` and `noIndex` |
| `/feed.xml` | Article bodies | Not exempt: follows site-wide Basic Auth; the query filters protected and `noIndex` articles |
| `/api/contact-form` | Writes while the site is locked | `readFormPost()` (section 6) |
| Config redirects | The destination of a gated path | None possible: they run before any app code (4.2) |
| `public/` files | Whatever is placed there | None: the CDN serves them. Never put gated content there |

### 1.4 Smaller gate gaps

| Gap | Fix |
| --- | --- |
| A failed state read fails open | `createProxySanityState()`: 5 minute hot cache tied to the content version, 60 s bounded stale-while-revalidate, 1 hour stale-if-error, 10 s retry backoff, 5 s fetch timeout, in-flight dedupe. With no state, `gateByCms()` logs and answers 503 with `Retry-After` (the 10 s backoff) and `Cache-Control: no-store`; deliberately even on an unprotected site |
| The gate reads the API CDN, whose publish invalidation misses result-set membership changes, so a newly protected page stays public | Live API with `perspective=published` behind the hot cache; `/api/revalidate` waits 3 s for Content Lake to settle, then bumps the content version, then invalidates tags, so the next read refetches a replica that has the publish |
| Settings read with `*[_type == "siteSettings"][0]` | By `_id` wherever it decides access, a destination or a recipient (gate state, the agent Markdown eligibility state and serve query, `SiteLockedQuery`, the llms.txt serve and inventory queries, redirects fetch, notification recipients, the alt text settings and stats), so a second document of the type created through the API cannot stand in. Rendering reads (header, footer, favicon, feed title) still match by `_type` |
| Basic Auth compared in a way that leaks length or prefix | SHA-256 digests through `timingSafeEqual` from `node:crypto`, both halves always compared; guessing is limited at the firewall |
| Under site-wide lock, unknown paths 404 and real ones 401 (an oracle) | The middleware gates before the catch-all reads the CMS, so both 401 (and a file spelling of either gets the same 404 with the challenge, 1.1); keep every existence check behind the gate |
| The section preview opens on a deployment | `gateAlways()` runs before the draft bypass and the Markdown rewrite, and answers 503 when credentials are unset |
| Protection is per URL: `/blog` does not cover `/blog/<slug>`; author pages and their modal partials follow Protect entire site only (a `person` has no Password protect) | Say so in the Studio (the blog's Password protect help does); every listing (blog list and categories, feed, sitemap, llms.txt, agent Markdown) filters `passwordProtected != true` and `seoMetadata.noIndex != true` |
| A CMS URI the gate never matches (a dot, `%`, whitespace, a backslash, a control character, a colon, `/index`, under `/api` or `/_`) | `uriGateProblem()` in the URI field, a warning that becomes an error under Password protect (Studio only); a colon would also render as a `javascript:` link |
| A CMS URI another route answers first, so the editor gets a dead URL the field claims to catch (anything under the Studio path, `/404`, the section preview prefix, `/blog/<slug>`, `/blog/authors/<slug>` or its `/modal` panel for a page; an article off `/blog/<slug>`, a person off `/blog/authors/<slug>`) | `reservedRouteIssue()` and `blogRouteIssue()` in `createUriField`, an error (Studio only); segment prefixes, so `/studios` and `/section-previews` still pass, and a deeper author path (`/blog/authors/jane/cv`) is the catch-all's. Nothing leaks: the shadowing route serves only its own type |
| A GROQ subquery inherits the caller's perspective, so a generator reading `raw` or `drafts` publishes draft lists | `withPublishedArticleLists()` re-reads listings as `published` |
| Query strings flow into the cache key and GROQ | `entryQuery()` keys only the parameters `ROUTE_QUERY_PARAMS` lists for the route, drops tracking ones, and stores nothing for any other (section 2); `requestedCategorySlugs()` passes up to 10 slugs of `[A-Za-z0-9_-]`, 64 characters each, trimmed, deduped and sorted, to GROQ as a parameter |
| `X-Forwarded-Host` steering `Astro.url` | Leave `security.allowedDomains` empty (Astro then ignores the header); build absolute URLs only with `absoluteUrl()` (`src/lib/site-url.test.ts` fails on a hand-built one) |

## 2. The route cache answers before the middleware

The provider (`cache.provider` in `astro.config.mjs`) wraps the whole middleware pipeline (`handleCache(state, runPipeline)`). A hit is answered before `src/middleware.ts` runs, so the gate, the alias 404 and the draft bypass never see it: the cache decides for itself.

- **Plain GETs only.** Any `__draft_session` or perspective cookie skips the cache (presence alone: a forged one only costs a render), and so does an `Accept` header containing `markdown`, since a cached HTML hit would answer before the rewrite.
- **Two keyspaces.** `gated:` only when `Authorization` equals the expected header exactly, compared in constant time; a header that matches nothing skips the cache.
- **Consult the gate before any public read or write.** `isPublicPath()` is false when the state is unknown. Without this, an entry stored while a page was public keeps answering after Password protect is turned on, until a tag happens to expire it:

  ```ts
  // A hit answers before the middleware gate, so a public entry is only read or written while the state says public.
  const isServable = async () => gated || (await isPublicPath(gatePath).catch(() => false));
  ```

- **Key on what the router renders (`decodeRequestPath()`), gate on what the page is (`canonicalRequestPath()`).** A path either refuses skips the store.
- **Only a route's own query parameters key an entry.** `entryQuery()` keeps the parameters `ROUTE_QUERY_PARAMS` (`entry.ts`) lists for the path (`category` on `/blog`), drops tracking ones (`utm_*`, `gclid` and the like), and stores nothing for any other parameter, more than 16 pairs or a value over 100 characters; the page still renders. A page that starts reading a new parameter adds it there, or its requests are never stored. The blog index also declines a view whose categories are not all known slugs in their canonical spelling (`isCacheableCategoryView()`, which makes it pass `false` to `cacheResponse()`), so made-up values mint no entries.
- **Store only a plain 200 that sets no cookie, with a lifetime the route asked for.** `entryTtl()` also reads Astro's pending cookies (`Symbol.for("astro.cookies")`), which become `Set-Cookie` only after the provider returns. 401, 404 and 503 are never stored.
- **A render that straddles a publish is not stored.** After its 3 s settle wait, the webhook bumps the content version before it purges tags, so a render that started before a publish can finish after the purge. The provider takes its baseline before rendering through the same deduped `contentVersion.read()` the render's queries join, so it is never newer than the version they carried, then reads again with `readFresh()` (which never joins a read in flight) and skips the write when the version moved. The check and the write are not atomic, so it reads fresh once more after writing and deletes the entry if the version moved in between. An unreadable version stores nothing.
- **No narrow key hashing.** `vercel-store.ts` passes `keyHashFunction: encodeURIComponent`: the Runtime Cache default hash is 32 bits, and a `gated:` and `public:` collision would hand a protected render to anyone.
- **Nothing cacheable leaves the app** (`setHeaders` returns empty headers), and each build gets its own keyspace (`build-partition.ts`), so a fix in markup or headers is never hidden behind the previous release's entries.

Draft renders: the middleware calls `context.cache.set(false)` for a verified session, but a page calling `Astro.cache.set(options)` afterwards turns caching back on. Every route caches through one helper:

```ts
export function cacheResponse({ cache, locals }: CacheTarget, options: CacheOptions | false): void {
  cache.set(locals.draftSession ? false : options);
}
```

`src/lib/cache.test.ts` fails when a page or an endpoint under `src/pages` (`.astro` and `.ts`) calls `cache.set(` directly; only `src/middleware.ts` (`cache.set(false)`) and `cacheResponse()` itself may.

The cache is not a flood shield: a query parameter the route does not read, an unknown category, any `__draft_session` cookie or `Accept: text/markdown` forces a render and CMS reads, and every miss reads the content version on top of the render's own reads (the middleware's gate state, every `loadQuery()`): the provider's baseline, and for a public render the route asks to cache, the gate state behind `isPublicPath()` and two `readFresh()` checks, each a Runtime Cache read on Vercel. Rate limits do that job (section 12).

## 3. Draft mode and preview

| Check | Fix |
| --- | --- |
| Draft mode starts only from Sanity's signed preview secret | `validatePreviewUrl` in `enable.ts`, after `hasPreviewSecretShape()` refuses anything the generator never makes (`[A-Za-z0-9_-]{20,64}`) with the same 401 and no Sanity read |
| Sanity unreachable during the handshake, or refusing the view token | The read is caught by `previewCheckFailed()` (`src/features/auth/preview-check.ts`): an uncached JSON `503` (`preview_unavailable`) with `Retry-After: 10`, or a `500` (`preview_misconfigured`, no retry) when Sanity answers a 4xx other than 408 or 429, never an uncaught throw that Astro's error render hands to the gate (1.2). The log line carries the error's name, status and network code, never the error itself: its message and `response.url` can quote the request URL, preview secret included |
| Other spellings of the path spend that read past the firewall rule | `isExactRoutePath()` (`src/features/api/exact-path.ts`) runs first: a path that does not resolve to exactly `/api/draft-mode/enable` (`/api/draft-mode//enable`, `/api/draft%2Dmode/enable`, a trailing slash) gets the same 401, so every read happens on a path ending in `enable` (section 12) |
| The middleware trusts only `__draft_session`, an httpOnly HMAC-signed expiry, verified once into `locals.draftSession` | The perspective cookie is `httpOnly: false` (the overlay rewrites it) and forgeable; `isDraftMode()` needs both, the session for trust and the cookie for the perspective |
| The session key is HKDF over `SANITY_API_VIEW_TOKEN` | No browser receives that token here (`VisualEditing` gets none, `sanity:client` stays server-only). If live preview ever ships a browser token, key the session on a separate secret, or preview access becomes the power to mint sessions |
| A key holder mints a cookie valid for decades | `verifyDraftSession()` rejects an expiry past now + 12 h + 60 s skew and any spelling but `^[1-9]\d{0,14}$`; bump `KEY_LABEL` (`draft-session:v2`) to revoke every session |
| "Open draft page" puts a never-expiring shared secret in a URL | `createPreviewSecret(client, "open-draft-page", window.location.href, currentUser?.id)` (private, 1 hour), never `enablePreviewAccessSharing()`. After replacing the latter, turn preview sharing off once in Presentation's share menu |
| An exit path leaves the session | `disable.ts` deletes the perspective cookie and `__draft_session` |
| A draft render reaches the cache, or draft content a public artifact | Section 2; the llms.txt generator reads `published`, and page Markdown generation, which reads the page being edited, re-reads the blog index's article list as `published` (`withPublishedArticleLists()`) |

## 4. Redirects

### 4.1 Open redirect through control characters

`startsWith("/")` and not `startsWith("//")` passes `/%09/evil.example`: the parser strips the tab and resolves `//evil.example`. Both draft-mode routes take a target from the URL (`?redirectTo=` on disable; on enable, the `sanity-preview-pathname` that `validatePreviewUrl` returns after a URL parser turned `/.//host` into `//host`), and Astro's `redirect()` emits a value verbatim. Both go through `src/features/auth/draft-session.ts`:

```ts
export function safeRedirectUrl(value: string | null | undefined, origin: string) {
  const fallback = new URL("/", origin);

  if (!value?.startsWith("/") || hasUnsafeRedirectCharacter(value)) {
    return fallback;
  }

  try {
    const target = new URL(value, fallback);

    // A `//` pathname is a protocol-relative host again once a caller emits it as a relative path.
    if (target.origin !== fallback.origin || target.pathname.startsWith("//")) {
      return fallback;
    }

    return target;
  } catch {
    return fallback;
  }
}
```

`hasUnsafeRedirectCharacter()` refuses code points up to `0x1f`, `0x7f` and `\`; `safeRedirectPath()` returns only path, query and hash. Tests: `/\t/x`, `/\n/x`, `/\r/x`, `/\t\\evil.com`, `//x`, `/\\x`, `/.//x`, `/a/..//x`, `/%2F/x`, `https://x`, `javascript:x`. Studio actions send a leading-slash path (`toSitePath()`), or a slug stored without one lands on `/`.

### 4.2 CMS redirects in the Astro config

`astro.config.mjs` reads `siteSettings.redirects` at config load (by `_id`, published, 10 s timeout) into Astro's `redirects`. Consequences:

- **They answer before any app code.** A redirect route skips the route cache, the middleware, the gate and the security headers, and on Vercel the adapter compiles it into a CDN route in `.vercel/output/config.json`. A redirect from a protected path answers without credentials (it reveals the destination, never the page).
- **One bad entry fails the deploy** (`Error generating redirects`). Astro accepts `[param]` and `[...rest]` sources, but this repo hands it literal paths only (below).

So `toConfigRedirects()` in `scripts/build/cms-redirects.mjs` keeps a strict subset and logs the rest: literal segments of `[A-Za-z0-9._~%-]` (no `[param]`, `:param`, wildcards, empty, `.` or `..` segments, no encoded slash, backslash or control character); a source with any `%` escape is refused, because Astro matches the decoded request path against the source as written, so it would never fire; destinations are same-site paths with an optional plain query (no `//` inside it) and an optional section anchor of `[A-Za-z0-9._~%-]` (an anchor never leaves the browser), or `https://` on the site's apex or `www`; sources under `/api`, the Studio path or `/_` are refused in any case (`/API/...`, `/Studio`); a destination that names the source's own address once its anchor, query, trailing slash and letter case are set aside would loop and is refused; 1024 characters at most. The Studio's **From** and **To** fields apply the same rules (`sanity/schemas/documents/redirect-path.ts`, `redirectPatterns: false` in `sanity/config.ts`), and also ask for a leading `/` and refuse a duplicate **From** (the build keeps the last); `scripts/build/cms-redirects.test.ts` fails when the two disagree. Inputs: `//evil.example`, `/\evil.example`, `/%09/evil.example`, `/%2F%2Fevil.example`, `/.//evil.example`, `https://www.example.com@evil.example/`, `/new?next=//evil.example#x`, `/a#<x>`, `/%61pi/x`, `/caf%C3%A9`.

Edits need a rebuild. The Redeploy button (`sanity/inputs/redeploy-input.tsx`) is a placeholder; when wired, it must POST through the `studioFetch` that `useStudioFetch()` returns, to a route gated by `authorizeStudioRequest` that holds the deploy hook, because a hook URL in Studio code ships in a public bundle.

## 5. Endpoints and abuse

### 5.1 `security.checkOrigin` stops browsers, not scripts

On by default (`astro.config.mjs` does not set it). For on-demand routes and unsafe methods with a form content type (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) or no `Content-Type` at all, Astro answers 403 when `Sec-Fetch-Site` is anything but `same-origin` or `none`, or, without it, when `Origin` differs (`node_modules/astro/dist/core/app/origin-check.js`). Other content types pass and rely on CORS preflight. It does not stop a script that sends neither header or the site's own origin, nor volume or replay. Keep it on as the CSRF defense, never disable it to accept a cross-site post, and treat every endpoint as callable by anyone.

### 5.2 One function, one `maxDuration`

`vercel({ maxDuration: 60 })` caps every on-demand route at once: the adapter emits a single `_render` function, so no public route gets a shorter cap than the screenshot route, and `waitUntil()` work shares the budget. So each upstream call carries its own timeout: gate and eligibility state 5 s, Studio session checks 5 s, page and agent Markdown reads 10 s (the read client's `timeout` in `src/sanity/lib/client.ts`; `@sanity/client` defaults to 300 s), contact form write 8 s, recipients 2 s and Resend 5 s, favicon 5 s with the body, Microlink 35 s then the asset 10 s then the upload until a 55 s deadline set before the Studio check, the redirects fetch 10 s at build. The edit client sets no `timeout`, so the generation routes' Sanity reads and Agent Actions are bounded only by the 60 s cap.

### 5.3 Checks for every endpoint

| Check | Fix |
| --- | --- |
| Every field validated server-side with caps | One isomorphic module per form, re-run by the endpoint (`contactForm`: names 100, email 254, phone 20, message 10 to 1000, enums for topic, budget, services, dial code; services deduped) |
| No regex on uncapped input (backtracking pins the function until the cap) | Cap first: `headerSafe()` slices before replacing, `screenshotTargetUrl()` refuses over 2048 characters, form bodies stop at 64 KiB |
| Upstream 404 told apart from 401, 403, 429 and 5xx | Three outcomes (found, not found, unavailable); the screenshot route answers Microlink's 429 with its own 502 and a hint |
| Errors carry fixed text and a stable code | `apiErrorResponse()`, `internalErrorResponse()` (logs the original), the webhooks included; the contact form answers every refused shape with one `formRefused()`, in the same words as the strict spam refusal |
| Studio and per-user JSON is uncacheable, success included | `privateJson()` sets `private, no-store` |
| Client-supplied ids never reach an SDK path unvalidated | Format check, server-side resolution, count caps; the webhook's `_id` and `_type` only become cache tags. The alt-text route refuses an `_id` that is not `image-<hash>-<w>x<h>-<ext>` (`isImageAssetId()` in `src/features/agents/alt-text.ts`, at most 200 characters) with a 400 before it reads settings, the asset, or patches |

### 5.4 The `/_image` endpoint

`passthroughImageService()` means nothing decodes an image, but Astro still injects and routes `/_image`. Nothing renders through `astro:assets`, so `classifyRequest()` (`src/features/auth/request-gate.ts`) answers it 404 under any query, before exemption or any gate, and `request-gate.test.ts` keeps the exploit URLs (`/_image?href=/secret&f=html` among them) on that answer. What the endpoint would do if that check went, from `node_modules/astro/dist/assets/endpoint/generic.js` and `loadImage.js`:

- A remote `href` gets 403 while `image.domains` and `image.remotePatterns` are empty; `//host` and `/%09/host` resolve off-origin and get 403 too. Adding a pattern makes the endpoint a fetcher for those hosts.
- A local `href` is fetched from the site's own origin with the caller's headers, so the inner request meets the gate with the caller's own credentials.
- The passthrough returns the bytes unchanged under a content type taken from `f` through `mrmime` (`f=html` is `text/html`, `f=svg` is `image/svg+xml`), so a same-origin text response such as `/llms.txt` or `/api/agent-markdown/<path>` (Markdown is not HTML-escaped) could render as HTML on the site's origin.

The last point is read from code, never proven against a build. A project that adopts `astro:assets` has to delete the check, so the endpoint is gated like a page, and accept only image formats (`webp`, `avif`, `png`, `jpeg`, `jpg`, `gif`) in `f`, or route the endpoint through an `image.endpoint.entrypoint` module that does. Check the 404 every audit (section 15).

## 6. Forms and email

There are no Astro Actions. The contact form posts `FormData` with `fetch` to `src/pages/api/contact-form.ts`, which the middleware never gates. The order is the contract: cheap refusals, validation, the write, then email off the response. `readFormPost()` returns the `FormData`, or the `Response` to send back as it is (`formRequestAnswer()`: 400 `formRefused()`, the 401 challenge, or 503).

```ts
export const POST: APIRoute = async (context) => {
  const formData = await readFormPost(context);

  if (formData instanceof Response) {
    return formData;
  }

  // Strict: `FormElement` always sends both fields, so a request without them is not from the form.
  const spamError = detectSpam(
    {
      honeypotValue: formData.get(HONEYPOT_FIELD_NAME),
      submissionTime: formData.get(SUBMISSION_TIME_FIELD_NAME),
    },
    { strict: true }
  );
```

| Check | Fix |
| --- | --- |
| Alternate spellings of the path slip past an exact-path firewall rule | `isExactRoutePath()` (`src/features/api/exact-path.ts`): the path as the URL parser resolves it must equal `routePattern`, else `formRefused()`. The parser has already resolved dot segments and backslashes, so the firewall rule matches paths ending in `contact-form` (section 12) |
| The body is read before anything is checked | `hasFormShape()`: `multipart/form-data` only, declared `Content-Length` up to 64 KiB; `readFormData()` then counts bytes as they arrive, since a chunked body declares nothing. Checked before the lock, so a request the form never sends learns nothing about it |
| `/api/` skips site-wide Basic Auth, so posts keep landing while the site is locked | `checkFormRequest()` (`request-guard.ts`): matching credentials, a verified preview session, or an unlocked site pass; otherwise the pages' 401 `basicAuthChallenge()`, and 503 (`formUnavailable()`, `Retry-After: 10`) when the state is unreadable or the lock is on with no `BASIC_AUTH_*` credentials set |
| Missing honeypot or timing fields count as "no signal" | `strict: true` makes them spam. Timing is client-sent, so this stops naive bots only; the firewall rule and BotID or Turnstile verified in the endpoint do the rest |
| A post sent without the form's script (no JavaScript, or a click before the element upgrades) goes out urlencoded and is refused | The submit button ships `disabled` (`SubmitButton`'s `disabled` prop), `FormElement` (`src/features/forms/form-element.ts`) enables it on upgrade, and a `<noscript>` line says the form needs JavaScript |
| The write uses `SANITY_API_EDIT_TOKEN`, which can edit and delete every document | Move the create to a dedicated token from the narrowest role the plan offers, in its own env var (section 11) |
| Submissions (personal data) as root documents, readable anonymously on a public dataset | Private datasets by default, and dotted ids through one helper (below): on a public dataset an anonymous query returns exactly the root-id documents (verified) |
| A timed-out write retried and stored twice | `withConfig({ maxRetries: 0 })` with an 8 s abort; an aborted write may still land, so `formWriteFailed()` answers it `504` with "We may have received this already. Please wait a moment before sending it again." instead of the generic retry text. A resend can still store a second document |
| Recipients used as stored | Read by `_id` with the view token (`sanityPublishedClient`), never the edit token; `pickRecipients()` strips invisible format characters (zero-width, bidi), validates, dedupes case-insensitively, caps at 50; one email per recipient |
| CMS, env or visitor strings become mail headers | `headerSafe()` strips control characters, line and paragraph separators and `<` `>`, caps (sender name 100, subject 200); `formatSender()` refuses a malformed `RESEND_EMAIL_FROM` and sends nothing |
| Visitor values in the email body | `escapeHtml()` on every value |
| The email awaited in the request path | `waitUntil()` after the write, wrapped in `withTimeout()` because the Resend SDK takes no abort signal |
| Submissions accumulate forever | Document retention and deletion; `scripts/sanity-dataset/seed.test.ts` keeps `contactFormSubmission` out of the seed |

```ts
export function apiOnlyDocumentId(type: ApiOnlyDocumentType, key: string = crypto.randomUUID()): string {
  const id = `${type}.${key}`;

  if (!API_ONLY_ID_KEY.test(key) || id.length > MAX_SANITY_ID_LENGTH) {
    throw new Error("[sanity/constants] apiOnlyDocumentId: the key must be letters, digits, _ or -, within Sanity's id length.");
  }

  return id;
}
```

`sanity/api-only-documents.test.ts` fails on a hand-built id or an API-only write that skips the helper. Pass a deterministic `key` for an idempotency lock, never personal data: Sanity keeps every id ever written.

## 7. CMS data and tokens

| Check | Fix |
| --- | --- |
| Studio-backed endpoints verify the caller server-side | `const denied = await authorizeStudioRequest(request)` first. The Studio sends its session token as a bearer via `useStudioFetch()`; the endpoint asks `/users/me` (robot tokens refused) and the Access API pinned to `v2025-07-11`. Never gate on `Origin`, `Referer` or a preview cookie; a login from any free account is not enough |
| A grant on another project counts | `grantsPublish()` counts a publish-mode grant only on `resourceType: "project"` with this `resourceId`, or one with no resource fields, and a `sanity.document.filter` update only on this project; tested with real payloads |
| Junk tokens reach Sanity or evict editors from the verdict cache | Shape first (RFC 6750 charset, 512 characters); verdicts cached 60 s per token hash, rejections in their own 100-entry cache; a Sanity error answers 503 uncached and is logged (`[studio-auth]`, the error only: a status or a network code, never the token) |
| A shared secret compared with `===` | `timingSafeEqual()` over fixed-length digests |
| The Studio token sits in `localStorage` on the site's own origin (`loginMethod: "token"`, Studio at `/studio`) | Any script injection on any page reads an editor's token, which is why sections 9 and 10 weigh more here; a Studio on its own subdomain removes the shared origin |
| Plugin credentials in the dataset | The Mux input keeps its token, secret key and signing key in `secrets.mux`, readable by every token that reads the dataset; scope the Mux key and rotate it when a reader leaves |
| One token for everything | The view token (reads, gate state, draft session key, notification recipients) and the edit token (writes, generation, uploads) rotate separately; robot tokens never expire, so rotate on every departure |
| A Studio endpoint fetches a caller-supplied URL | `screenshotTargetUrl()`: plain `https` on the site's apex or `www`, no port or userinfo, control characters and backslashes refused raw; the provider's asset must be `https` on its domain, downloaded with `redirect: "error"`, JPEG or PNG only, 10 MB cap |
| The dataset is public, or CORS trusts any local app | Private by default (setup wizard); CORS origins are the production host plus one dedicated local origin; drop plain `http://localhost:<port>` with credentials after launch |

## 8. Webhooks and cache invalidation

- `/api/revalidate` verifies the signature on the raw text before any parse (`verifyWebhookDelivery()`): a missing, stale or wrong signature is 401 (`stale_signature`, `invalid_signature`) whatever the body, never a parse error; a signed body that is not JSON, lacks non-empty string `_id` and `_type`, or carries a `uri` that is neither a non-empty string nor null is 400 `invalid_payload`. Every answer is an `ErrorResponse` with fixed text, and an unexpected throw is a logged 500 `internal_error`, so Sanity redelivers.
- `sanity-webhook-signature` is `t=<unix ms>,v1=<sig>`. `t` is in milliseconds, so a check written in seconds accepts everything. The window is one hour (Sanity delivers one request at a time per webhook, so a bulk publish queues) with one minute of future skew:

  ```ts
  function isRecent(timestamp: number, now: number) {
    return timestamp <= now + MAX_CLOCK_SKEW_MS && now - timestamp <= WEBHOOK_MAX_AGE_MS;
  }
  ```

  The final compare is constant time over the canonical header (`@sanity/webhook` itself uses `!==`).
- The handler waits 3 s for Content Lake to settle, then bumps the content version, then invalidates tags, so the gate state, the agent Markdown eligibility state and published reads refetch a replica that has the publish, and a render that straddles the publish is not stored (section 2). A bump the store does not keep (or that throws) still lets the tags expire, so content refreshes, and only then answers a logged 500 `internal_error`, so Sanity redelivers and the redelivery bumps again. Until one does, the gate and eligibility state wait for their five-minute TTL and the straddle check cannot see that publish. A throwing invalidation is the same 500.
- `SANITY_REVALIDATE_SECRET` has `min: 32`. `/api/cache-purge` reuses it as a constant-time bearer (401 `invalid_secret`) and empties everything through `route-cache:all` after a bump, answering the same `ErrorResponse` codes (a bump that does not stick is a 500 that empties nothing); with the in-process store it reaches only the receiving instance.
- Never give `/api/revalidate` a rate limit of its own (section 12).
- If a project adds payments: verify the provider signature on the raw body first, key idempotency on the session id through `apiOnlyDocumentId(type, sessionId)`, derive entitlements from the provider's line items, never client metadata, and answer 5xx on transient upstream errors so the provider redelivers.

## 9. CMS values in rendered HTML (Astro escapes, it does not sanitize)

Astro HTML-escapes attribute values, so a CMS string cannot leave the attribute, but it never checks what the value means. With `addAttribute` from `astro/runtime/server/index.js`:

```text
addAttribute("javascript:alert(1)", "href")            ->  href="javascript:alert(1)"
addAttribute({ color: "x);position:fixed" }, "style")  ->  style="color:x);position:fixed"
```

**Links, two layers.** The GROQ link fragment (`src/features/sanity/link/fragment.ts`) returns a `href` only when it starts with one `/`, `?`, `#`, `http://`, `https://`, `mailto:` or `tel:`, so a component rendering `link.href` directly never gets a runnable scheme. The renderers (`SanityLink.astro`, rich text `Link.astro`, `ArticleList.astro`, `AuthorLink.astro`, the article and author pages, and the CTA, 404 and announcement links in `Cta.astro`, `SiteError.astro` and `SiteAnnouncement.astro`, which render no link when it refuses) run `safeHref()`, and so does the JSON-LD built from CMS links (the Organization `sameAs` in `src/sanity/seo.ts`, the blog `ItemList` in `ArticleList.astro`, the author `sameAs` and `ItemList` in `src/pages/blog/authors/[slug].astro`), before any `new URL()` or `absoluteUrl()` could make `//evil.example` an off-site absolute URL; the feed and agent Markdown run `absoluteSafeHref()`:

```ts
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: browsers strip these while parsing, which is how a scheme hides.
const UNPARSEABLE = /[\u0000-\u001f\u007f\\]/;
```

Both layers are needed: the GROQ filter is a prefix allowlist and passes `/\t/evil.example` (one leading slash), which a browser reads as `//evil.example`; `safeHref()` refuses control characters and backslashes. `relativeHrefProblem()` in the Studio is UI only. Inputs: `javascript:alert(1)`, ` JAVASCRIPT:x`, `java\tscript:x`, `java\nscript:x`, `\u0001javascript:x`, `//evil.example`, `/\evil.example`, `/\t/evil.example`, `data:text/html,x`, `vbscript:msgbox(1)`, `file:///etc/passwd`.

Three sinks sit outside that list. Rich text `Link.astro` is mapped for both `linkField` and `link`: `astro-portabletext` merges the mark map over its defaults, whose `link` writes `markDef.href` unchecked, and the rich text GROQ spreads every markDef, so an API-written `_type: "link"` would reach the page raw (`mark-map.test.ts` fails when a default mark that renders `<a` is left unmapped; the feed maps `link` the same way). `Link.astro` hands `safeHref()` only a string, so a bare `link` decorator or a non-string `href` stored through the API renders the text instead of throwing. Agent Markdown percent-encodes `(`, `)`, `[`, `]`, `<`, `>` and whitespace in every destination it writes (links, images and the article list, through `markdownHref()` in `src/features/agents/markdown.ts`), because `new URL()` keeps them and a fragment or `mailto:` is never normalized, so `https://ok.example/a)[pwn](javascript:alert(1)` would close the link early and open a runnable one; link text is not escaped, and Markdown stored before the encoding keeps its text until regenerated. A media `src` is an attribute too: an external video URL is projected as stored, so `SanityNativeVideo.astro` renders its source only through `safeVideoSrc()` (`src/features/sanity/media/utils.ts`: a string, `stegaClean()`, then `safeHref()`), and nothing for `data:`, `javascript:`, `//host` or a value that is not a string.

**Colors.** The color annotations used to build `var(--color-${name})` from the stored string, rendered by `TextColor.astro` and `HighlightColor.astro` as `style={{ color }}` and `style={{ backgroundColor }}`. An API write of `x);position:fixed;inset:0;background:url(https://evil.example/beacon` rendered `style="color:var(--color-x);position:fixed;inset:0;background:url(https://evil.example/beacon)"`: a full-page overlay and a beacon. Now a palette name resolves to its token, a strict hex (older content stored one) to itself, and anything else to no color:

```ts
export function tokenColor(value: string | null | undefined): string | undefined {
  const cleaned = stegaClean(value ?? "").trim();
  const color = findBrandColor(cleaned);

  if (color) {
    return `var(--color-${color.name})`;
  }

  return isHexColor(cleaned) ? cleaned : undefined;
}
```

`stegaClean()` first, because draft mode adds invisible characters that would miss the lookup. The hex pattern lives once, in `isHexColor()` (`sanity/colors.ts`), which the Studio field and the editor preview share; it is anchored and has no room for a space, `;`, `)` or `!`, so a hex cannot carry a second declaration. The Studio field (`sanity/schemas/fields/app-color.tsx`) warns on a hex and refuses anything else, but only in the Studio. Inputs (`src/sanity/rich-text/components/token-color.test.ts`, the hex rule alone in `sanity/colors.test.ts`): the beacon string, `#ff9100);position:fixed;inset:0;background:url(https://evil.example/beacon`, `#ff9100;position:fixed`, `#ff9100 !important`, `#ff9100` with a zero-width character inside, `brand-accent);position:fixed;inset:0`, `brand-accent;position:fixed`, `BRAND-ACCENT`, `red`, `rgb(255, 145, 0)`, `var(--color-brand-accent)`.

**Aspect ratios and placeholders.** The media `aspectRatio` field is a number in the Studio, but an API write can store a string, and six renderers wrote it into `style` (`Media.astro` and `MediaBlock.astro` through `InnerParallax`, `String(aspectRatio)` in `SanityLottie`, `SanityNativeVideo`, `SanityRive`, `SanityMuxVideo`): `1;position:fixed;inset:0;background:url(https://evil.example/beacon` became the same overlay and beacon. Two layers again: the media fragment selects `aspectRatio > 0 => aspectRatio`, which a string never satisfies, and every sink renders `cssAspectRatio()` (`src/features/sanity/media/utils.ts`: a finite number above 0, clamped to 1/20 to 20, else nothing). The asset `lqip` goes into `url(...)` only through `safeLqip()` (a base64 `data:image/(jpeg|png|webp|gif)` URI) in `getLqipStyle()`. Inputs: the beacon string, `"16/9"`, `NaN`, `Infinity`, `0`, `-1`, and an lqip ending in `),url(https://evil.example/beacon`.

**Other sinks** (`grep -rn "set:html\|innerHTML\|insertAdjacentHTML" src`): `JsonLd.astro` escapes `<` as `\u003c` inside `set:html`; `Icon.astro` renders a static map; the author dialog sets `innerHTML` from an Astro-rendered partial fetched only for same-origin author paths; the feed body goes through `@portabletext/to-html` with `escapeHTML`, the notification email through `escapeHtml()`. XML is the same sink with a different escaper: every sitemap `<loc>` and `<lastmod>` and every feed text value (the article HTML goes in CDATA) goes through `escapeXml()` (`src/lib/xml.ts`, used by `renderSitemap()` in `src/lib/sitemap.ts` and by `src/features/feed/xml.ts`), so one CMS URI with `&` or `<` cannot invalidate the document.

## 10. Response headers and CSP

Built once in `src/lib/security-headers.ts` and set by `responseHeaders`, the first middleware in `src/middleware.ts`, so the middleware's own 400, 401, 404 and 503 answers carry them (Astro's 400 for an over-encoded path and the `checkOrigin` 403 run before it and carry none):

```ts
always: [
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ["X-Frame-Options", "SAMEORIGIN"],
  ["Content-Security-Policy", `frame-ancestors ${frameAncestors(config.siteUrl)}`],
],
```

- **Frame protection is enforced**; a Report-Only `frame-ancestors` never blocks. `frameAncestors()` lists `'self'` plus the site's apex and `www` origins, so Presentation (same deployment) works from either host. A Studio framed from the sanity.io dashboard or another origin needs that origin added.
- **The full policy is Report-Only**, on every route but the Studio (decided by `context.routePattern`): `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cloud.umami.is`; `connect-src` with Umami (`cloud.umami.is`, `gateway.umami.is`), the project's Sanity API, API CDN and `wss` host plus `api.sanity.io` and `www.sanity.io` (Visual Editing), `cdn.sanity.io` (Rive and Lottie files), Mux (`stream.mux.com`, `*.mux.com`, `*.litix.io`) and the WASM CDNs Rive and dotLottie load their runtimes from (`unpkg.com`, `cdn.jsdelivr.net`); `img-src` with `cdn.sanity.io` and `image.mux.com`; `media-src 'self' blob: https:`; `worker-src 'self' blob:` (hls.js); `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Vercel toolbar origins only when `process.env.VERCEL_ENV === "preview"` (read at runtime), `ws:` only in dev. Every origin and its reason is in `docs/features/security-headers.md`.
- Inline scripts carry no nonce and cached pages could not vary one, so `'unsafe-inline'` stays; the value is the inventory and the non-script directives. Enforce once the console is clean on every template, after self-hosting the Rive and dotLottie WebAssembly; give the Studio its own policy first.
- **What never gets these headers:** `public/` files and `/_astro/*` (CDN), config redirects (no middleware), Astro's 400 for a path encoded more than ten levels deep (answered before any middleware) and the `checkOrigin` 403 (that middleware runs ahead of `responseHeaders`). A cache hit carries the headers it was rendered with; a new build is a new keyspace, so header changes ship with the deploy.
- HSTS is left to the host (check it live); skip `Cross-Origin-Opener-Policy` until tested against every popup flow. `nosniff` does not help when a route itself declares `text/html`, which is why `/_image` answers 404 (5.4).

## 11. Secrets, env and client bundles

- Every secret is declared in `env.schema` (`astro.config.mjs`) as `envField.string({ context: "server", access: "secret" })` and read only from `astro:env/server` through `src/lib/env.ts`, so a client import is a build error. `PUBLIC_*` variables are inlined into the browser bundle. `validateSecrets: true` fails the build on a missing required secret.
- Signing secrets get a minimum length in the schema; a new minimum fails validation for a shorter deployed value, so rotate first. Basic Auth passwords are left to the operator and the firewall.

  ```js
  SANITY_REVALIDATE_SECRET: envField.string({ context: "server", access: "secret", optional: true, min: 32 }),
  ```

- `astro.config.mjs` reads `SANITY_API_VIEW_TOKEN` with Vite's `loadEnv` and hands it to the `@sanity/astro` integration, which bakes it into the `sanity:client` virtual module. Safe only while no client code imports `sanity:client`: Biome's `noRestrictedImports` bans it everywhere except `src/sanity/lib/client.ts` (a biome-ignore), which imports `~/lib/env` and through it `astro:env/server`, so a client import of that module fails the build. Keep both.
- Studio code runs in the browser: `sanity/config.ts` holds public values only, `SANITY_STUDIO_*` is public, and a deploy hook URL is a secret.
- In Vercel every secret is Sensitive; the edit token, the revalidate secret and Basic Auth credentials target Production unless Preview needs them. Preview builds read the same `PUBLIC_SANITY_DATASET` unless overridden, so a Preview with the edit token writes to the production dataset.
- Adding an env var: `env.schema` in `astro.config.mjs`, `src/lib/env.ts`, `.env.example`, the local `.env`, the table in `docs/deployment.md`, the Vercel targets.

## 12. Vercel baseline

### Firewall rate limits

Rules apply without a redeploy, so this is the fastest protection to add. Fixed window keyed on IP, respond 429, sized from real client behavior with at least 2x headroom.

| Rule | Condition | Limit per IP | Protects |
| --- | --- | --- | --- |
| Contact form | Method `POST`, path ends with `contact-form` | 30 per 600 s | A Sanity write with the edit token and an email per recipient per accepted post. Not "equals": dot segments and backslashes are resolved before the endpoint's exact-path check, so `/api/x/../contact-form` reaches it. Add every new form endpoint |
| Preview handshake | Path contains `draft-mode` and ends with `enable` | 30 per 60 s | A Sanity read per well-shaped preview secret. Not "starts with": `enable.ts` refuses every spelling that does not resolve to its exact path, but `/api/./draft-mode/enable` and `/api/draft-mode/./enable` reach it as the exact path. `disable` spends no read |
| Studio-backed routes | Header `authorization` starts with `Bearer`, any path | Sized from the heaviest Studio use (a bulk alt-text run) | Two Sanity calls per unknown well-shaped token; AI and Microlink quota. `authorizeStudioRequest()` spends nothing without a bearer header, so this counts every spelling of every Studio route; the cache purge's manual call counts too |
| Basic Auth attempts | Header `authorization` exists and does not start with `Bearer`, any path | Above a signed-in session's peak: a signed-in browser sends the header on every request to the site, `/_astro/` assets and the Studio's bundle included | Online guessing; the code has no lockout. The gate reads only a `Basic` header as credentials, so every guess lands here |
| All requests | Any method, any path | 600 per 60 s; check it against an editor's first Studio load, whose bundle comes from `/_astro/` | Random paths, methods and query strings, each a render and CMS reads: a page renders for any method `checkOrigin` lets through, and only GETs are route-cached. Also agent Markdown, which has no tighter rule (below) |

- Never give `/api/revalidate` a rule of its own. The all-requests rule counts its deliveries and stays far above them: Sanity sends one at a time and each is held 3 s by the settle wait, so a webhook makes at most about 20 a minute.
- A rule a request can sidestep is not a rule. Conditions may match the path as sent, before dot segments and backslashes resolve, and Astro decodes the path before routing, so a "starts with" or "equals" rule on an endpoint that accepts other spellings is sidestepped with `/api/./<route>` or `/api/%61gents/...`. Either the endpoint refuses other spellings first (`isExactRoutePath()` for a route without params) and the rule keys on what every accepted spelling contains and ends with (the contact form and preview rules), or the rule keys on what every costly request has to carry, whatever its path. The two `authorization` rules split every header between them, so a Studio check and a Basic Auth guess each meet one of them even when the firewall compares `Bearer` case-sensitively.
- No rule excludes a path prefix. A missing file under `/_astro/` and an `/api/` path with no handler fall through to the `[...uri]` page (a render, CMS reads and, on a locked site, a credentials check), and `/_astro/../<page>` can reach the page itself, so an excluded prefix is a way around the rule. Size the rules from real loads instead.
- Agent Markdown has no tighter rule of its own: the direct route answers `/api/%61gent-markdown/...`, so a path condition is sidestepped, and the rewrite reads `Accept` case-insensitively, so `text/MARKDOWN` slips past a case-sensitive `accept contains markdown`. The all-requests rule counts every answer. A tighter rule first needs the route to refuse every spelling of its prefix but the literal one, as the form endpoints do.
- At the time of writing rate limiting is on every plan (Hobby: one rule, make it the contact form; Pro: 40, windows 10 s to 10 minutes), billed per million allowed requests that match, blocked requests free. Counters are per region.
- Leave Bot Protection and "block AI bots" off while the site serves agents on purpose; verify BotID or Turnstile inside the form endpoint instead. Publish staged rule changes from "Review Changes".

### Project settings

- Vercel Authentication on every deployment URL except custom domains; no protection bypass tokens unless an automation needs one (delete a temporary one after); Git fork protection on.
- Changing an env var's targets needs no redeploy when the Production value is unchanged; a new value does, and the new build starts a fresh route cache keyspace.
- The apex redirects to the canonical host with 308, not 307.

### Domains and DNS

- HSTS is on by default; `.dev` and `.app` are preloaded by their TLDs.
- A domain that sends no mail: `_dmarc TXT "v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:<owner>"` and SPF ending in `-all`. The Resend sending domain gets its own DMARC once DKIM aligns; move the parent from `p=none` toward `reject` with the reports.
- A CAA record for only the certificate authorities your host uses, and DNSSEC where the registrar supports it.

### Read-only checks

```bash
vercel api "/v9/projects/<projectId>?teamId=<teamId>"
vercel api "/v1/security/firewall/config/active?projectId=<projectId>&teamId=<teamId>"
vercel api "/v10/projects/<projectId>/env?teamId=<teamId>" | jq '.envs[] | {key, type, target}'
curl -sSI https://<host>/
dig +short TXT _dmarc.<domain>
dig +short CAA <domain>
npm run sanity:cli -- dataset visibility get <dataset>
npm run sanity:cli -- cors list
npm audit
npm audit --omit=dev
npm run build && jq -c '.routes[]' .vercel/output/config.json
```

The firewall call returns 404 when no rules exist. The raw env response includes values (plaintext for `plain` variables), so always filter it to key, type and target, and never decrypt values for an audit. The last command lists what the CDN answers before the function (the `filesystem` handle, the `/_astro` header, every config redirect): none of it meets the middleware.

## 13. Dependencies and supply chain

- Use the project's Node and npm (`.nvmrc`, `engines`: Node 24.15.0, npm 11.6.2 or later); an older npm rewrites the lockfile and suggests bogus fixes.
- Judge each advisory by reachability: no Astro Actions, no server islands in use (the route exists and stays gated), no image decoding (`sharp` is used only by `scripts/section-thumbs/capture.ts`), Studio dependencies run in the editor's browser. Patch Astro and `@astrojs/vercel` within days anyway: path decoding, `.html` stripping, the origin check and the adapter's path-override checks live in their code.
- `npm audit fix` nests duplicates when a root dependency is pinned to an older exact version; bump the root first. After any update, diff the lockfile for transitive majors. Triage advisories by hand with `npm audit`.
- `package.json` pins every dependency and devDependency to an exact version, so a fresh install never resolves a release nobody reviewed; add new ones exact (`npm install --save-exact`). Only `overrides` keeps a range.
- Pin CLI and MCP tools to exact versions, never `@latest`. This rule wins over a vendored skill that says to run or allowlist `npx <pkg>@latest` (`modern-web-guidance` does); pin the version when you allowlist it. `.mcp.json` pins `chrome-devtools-mcp@1.10.1` and `@mozilla/firefox-devtools-mcp@0.10.4`, and `lefthook.yml` runs every hook through `npx --no`, naming the package (`@biomejs/biome` directly, `--package=<pkg>` before the bare `astro` and `commitlint` binaries), so a hook never fetches a package or runs a cached look-alike. Pinning covers the top-level package only, so prefer devDependencies, and keep local `.env` values test-scoped where possible.
- GitHub Apps on the org get access to only the repos they need.

## 14. Operator scripts and seed data

| Check | Fix |
| --- | --- |
| `--clean --yes` deletes the target after a failed backup | A failed pre-clean backup stops a `--yes` run (`scripts/sanity-dataset/migrate.ts`) |
| A destructive flag hits the live dataset | `liveTargetError()`: unattended `--clean`, `--replace` or a trim purge on the `.env` dataset needs `--allow-live-target <name>`; import and migrate make an interactive operator type the name |
| `import --replace --yes` defaults to the `.env` dataset | `importTargetError()` requires `--dataset` |
| Public datasets by default; import and migrate never check | Setup defaults to private; `publicTargetError()` refuses a public or custom-ACL target without `--allow-public`; clean reads the recreated dataset back, because the CLI silently creates a public one when the plan has no private datasets |
| Errors print CLI output that holds a new token | `parseJsonFromCliOutput()` and `parseCreatedToken()` never quote output; tokens the run created and did not keep are revoked on every exit path |
| A credentialed CORS origin for any local app, wildcards slipping past a loopback check | `corsOriginKind()`: a `*` origin always needs an explicit answer; loopback is detected after URL normalization (`0`, `[::ffff:7f00:1]`) |
| A capture script sends Basic Auth credentials to every host that answers 401 | `httpCredentials.origin` scoped to the target (`scripts/section-thumbs/capture.ts`) |
| The seed carries preview secrets, plugin secrets, submissions, drafts or a second settings document | `scripts/sanity-dataset/seed.test.ts`: type allowlist, secret-shaped keys, no dotted ids, one document per singleton with its own id |
| Weak or missing signing secrets | Setup fills `SANITY_REVALIDATE_SECRET` with 64 hex characters when empty and flags a short existing value instead of replacing it |
| Full exports (submissions, preview secrets, `mux.apiKey`) in `./backups` committed by accident | `.gitignore` lists `/backups` and `*.tar.gz` with the seed archive as the one exception; `scripts/sanity-dataset/lib.test.ts` fails when the folder `export.ts` or `migrate.ts` writes to is not ignored |

## 15. Verify after fixing

`npm test` (every input in the bypass, Inputs and Tests lists above is a unit test; the curl spellings below are runtime checks), `npm run check`, `npm run build`, the CDN routes in `.vercel/output/config.json`; then a Preview deployment, then production after deploy (GET and HEAD only):

```bash
# One URL per page: file spellings 404, ambiguous spellings 400, never a page
for p in /x.html /index.html /index /%78.html; do curl -sS -o /dev/null -w "$p %{http_code}\n" "https://<host>$p"; done
curl -sS -o /dev/null -w '%{http_code}\n' "https://<host>/a%2Fb"
curl -sS --path-as-is -o /dev/null -w '%{http_code}\n' "https://<host>/x/%252e%252e/<protected>"
# A protected page challenges under every spelling and every Accept
curl -sSI "https://<host>/<protected>.html" | grep -i www-authenticate
curl -sSI --path-as-is "https://<host>/x/%2e%2e/<protected>" | grep -i www-authenticate
curl -sSI -H 'Accept: text/markdown' "https://<host>/<protected>" | grep -iE '^HTTP|www-authenticate'
curl -sS -o /dev/null -w '%{http_code}\n' "https://<host>/api/agent-markdown/<protected>"
# An agent's 404 is the Markdown map (404, text/markdown); on a locked site, the 401 instead
curl -sS -o /dev/null -H 'Accept: text/markdown' -w '%{http_code} %{content_type}\n' "https://<host>/no-such-page"
# Preview only: the contact form refuses another spelling of its path before reading a body, expect 400
curl -sS -o /dev/null -X POST -w '%{http_code}\n' "https://<host>/api/contact-form/"
# Route cache: MISS then HIT on a public page; after Password protect is published, 401
curl -sSI "https://<host>/<page>" | grep -iE '^HTTP|x-astro-cache'
# Open redirect: must land on the site's own origin
curl -sS -o /dev/null -w '%{redirect_url}\n' "https://<host>/api/draft-mode/disable?redirectTo=/%09/evil.example"
# Headers: frame protection everywhere, no Report-Only policy on the Studio
curl -sSI "https://<host>/" | grep -iE 'x-frame-options|content-security-policy'
curl -sSI "https://<host>/studio" | grep -iE 'x-frame-options|content-security-policy'
# Image endpoint: 404 under any query, never 200 text/html
curl -sSI "https://<host>/_image?href=/llms.txt&f=html" | grep -iE '^HTTP|content-type'
```

Then every template in a real browser with the console open: no `[Report Only]` violations, client navigation and the author dialog work, Presentation previews drafts, and the contact form submits (on Preview, never production).

## False positives (claims that fail verification)

| Claim | Why it fails |
| --- | --- |
| `security.checkOrigin` stops form spam | It constrains browsers only; a script sends no `Origin` and no `Sec-Fetch-Site`, or the site's own |
| Rejecting requests without an `Origin` header stops abuse | Scripts send any `Origin` |
| A forged `__draft_session` or perspective cookie bypasses Basic Auth or shows drafts | The middleware verifies the HMAC and the expiry ceiling; a forged cookie only makes the route cache skip that request |
| Caching Basic Auth traffic leaks protected pages | Gated entries live under `gated:`, read only on an exact credential match; public entries are re-checked against the live gate state |
| `/_image` is an SSRF | It answers 404 here. Once a project re-enables it, remote `href`s get 403 while the image allowlists are empty, and `//host` or `/%09/host` resolve off-origin and get 403; its content type is the real risk (5.4) |
| Prerendered pages escape the middleware | True for Astro in general, not here: `output: "server"` and no route sets `prerender = true` |
| A neutral error message closes an information leak | The outcome still differs (refused versus stored) |
| Switching the Studio login mode keeps the token out of `localStorage` | Default modes fall back to `localStorage` when third-party cookies are blocked, and the Studio endpoints need `loginMethod: "token"` |
| Framing the embedded Studio lets a site steal an editor's session | Cross-site frames get partitioned storage, so the framed Studio is signed out; `frame-ancestors` refuses it anyway |
| Removing "allow credentials" from local CORS origins is a fix | Token-based Studio auth needs credentials; the local Studio breaks |
| Self-hosting version-pinned WASM from a CDN is a security fix | Pinned URLs and WASM cannot read storage; it only narrows the CSP |
| Every uncached request hits the live CMS API | Published page reads go through the API CDN keyed by the content version; only the gate and eligibility state use the live API, behind a hot cache |
| An Astro advisory on the installed version means the site is exploitable | Check reachability first (Actions, server islands, image transforms, i18n); patch regardless |
| Adding a `500.astro` page stops an endpoint's throw from meeting the gate | The error render runs the middleware again on the `/500` route, a page route, so `classifyRequest()` still gates it as the page the request path names: a challenge on a locked site. Only catching the throw in the exempt branch keeps it off the gate (`runExemptRoute()`, 1.2) |

## Reporting

Write findings so the next reader can act without the conversation:

- ID, severity by realistic impact, `file:line` or URL, what is wrong, a concrete exploit scenario with preconditions, evidence (code quote, live response, test), and a concrete fix.
- Mark which findings were verified, which were disputed, and which reviewer changed the severity.
- List what was checked and found safe, so coverage is visible.
- Separate code fixes from owner actions (dashboards, DNS, rotating secrets) and product decisions (retention, who may preview), and say where each is done.
- Keep the report out of the repo when it contains working exploits for unpatched issues.
