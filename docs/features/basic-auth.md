# Basic Authentication

HTTP Basic Auth uses **one username and password from the deployment environment** (`BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`). Sanity only stores **toggles**:

1. **Settings → Security**: **Protect entire site** gates every public page (except the Studio, the API endpoints, and the site's file routes such as `robots.txt`).
2. **Per page**: when the site is **not** fully protected, **Password protect** on a Page, Legal page, Article or the Blog index gates that document's URL only. On the Blog index that is `/blog` alone: each article keeps its own switch, and author pages and the RSS feed follow only **Protect entire site**. The same env credentials apply to site-wide and per-URL protection.

## How it works

1. Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` in your deployment environment. Local `astro dev` never gates (see **Excluded from Basic Auth**), so these are only needed locally if you build and run the production output.
2. **Site-wide:** **Settings** → **Security** → **HTTP Basic Auth** → enable **Protect entire site**.
3. **Per URL:** Leave **Protect entire site** off. On a **Page**, **Legal page**, **Article** or the **Blog** index, turn on **Password protect**.
4. At runtime, `src/middleware.ts` reads the **published** toggles via `getSanityBasicAuthState()` (see **The gate state** below). Toggling a switch in the Studio only writes a **draft**; the change takes effect on **Publish**. With the revalidate webhook set up, the first request after the webhook's three-second settle wait reads the new toggles, unless that read fails (see **The gate state**); without it (or on an instance the in-process content version does not reach), they arrive within about five minutes.

If Basic Auth is enabled in the CMS but env credentials are missing, the middleware responds with **503** and a short message so you can fix deployment config.

Credentials are compared through fixed-length SHA-256 digests (`hasBasicCredentials` in `src/features/auth/basic-auth.ts`), and the username and password are always both compared, so response timing reveals neither the length nor a matching prefix of either. There is no attempt throttling in code: use a long random `BASIC_AUTH_PASSWORD` (32+ characters, `openssl rand -base64 32`) and add a per-IP rate-limit rule in the Vercel Firewall for requests whose `Authorization` header exists and does not start with `Bearer`, on any path. The gate reads only a `Basic` header as credentials, and the Studio routes and the cache purge send bearer tokens, so the header alone picks out every guess. Leave the path out of the condition: a missing file under `/_astro/` and an `/api/` path with no handler both reach the catch-all page, which checks credentials on a locked site, and `/_astro/../<page>` can reach the page itself, so an excluded prefix lets guesses through uncounted. A signed-in browser sends the header with every request to the site, assets and the Studio included, so size the limit from a real signed-in session.

Draft mode bypasses Basic Auth so editors can use Visual Editing without entering credentials on every request. Only a signed Studio preview session counts: the `__draft_session` cookie the draft-mode enable route sets after Sanity's preview secret validates (see [Draft Mode and Visual Editing](../sanity/draft-mode-and-visual-editing.md)). The perspective cookie on its own proves nothing. The Studio itself sits behind Sanity auth.

The middleware also handles **agent Markdown content negotiation** (see [Agent Markdown](./agent-markdown.md)). That branch runs before the Basic Auth gate but defers to it: a request that prefers `text/markdown` is only rewritten to the Markdown route when the site is **not** site-wide protected and the path is **not** password protected, so protected content is never served as Markdown. It uses its own cached eligibility read (`src/features/agents/markdown-proxy-state.ts`), separate from the auth state below but tied to the same content version, so a published **Protect entire site** stops the rewrite on the same next request that locks the HTML. It fires only for agent requests. An agent asking for a path the site does not have gets the Markdown recovery map instead of the HTML 404 page (`notFoundRender()` in `src/features/agents/serve-agent-markdown.ts`), still through the CMS gate, so a locked site or a protected page never gets the map. An unknown path on a locked site gets the `401` before the page renders. A file spelling (`/secret.html`) answers 404 before the CMS gate, so when the page it names is protected, or the site is locked, it gets the gate's answer in place of the map: the challenge text and `WWW-Authenticate` header, under the `404` status Astro keeps on a 404-page render.

## The section preview is always gated

`/section-preview` and everything under it is authoring tooling, so it does not follow the toggles above. On every deployment it asks for the same env credentials whatever **Protect entire site** is set to, and it is checked before the draft session bypass and the agent Markdown rewrite, so neither opens it. With the credentials unset it answers **503** rather than serving anything. `astro dev` stays open, so local work and the thumbnail capture need no credentials. See [Section previews](./section-previews.md).

## One path per page

Every decision the middleware makes keys on one canonical path, never on the spelling a request arrives with (`src/features/auth/canonical-path.ts`):

- **Decoded the way the router decodes it.** `/%C3%BCber-uns`, `/u%CC%88ber-uns` and `/über-uns` are one page, so **Password protect** on a page whose URI is not plain ASCII protects every spelling of it. Request paths and the stored `uri.current` values are both NFC-normalized, with the same trailing-slash rule, before they are compared.
- **Refused when the router and a check could read it differently.** A path that still carries an escape after decoding (`%2F`, `%3F`, `%25`), an encoded backslash (`%5C`), a dot segment that only appears once decoded (`%252e%252e`), or broken encoding answers **400**. A raw backslash, `/../` and `%2e%2e` are resolved by the URL parser before any check, the same way the router sees them. The route cache does not store a refused path either. The check runs on the path as the URL parser resolves it, nothing decoded (`requestPathname()`, `new URL(request.url).pathname`, the same input the route cache keys on), never on `context.url`: Astro decodes that one, and the pathname setter turns a decoded backslash into a slash, so `/team%5Cprivate` would be checked as `/team/private` while the router renders the page stored as `team\private`.
- **One URL per page.** A page route also answers its file spellings (`/about.html`, `/blog/post.html`, `/index.html` for the homepage), so the middleware answers those with **404** before the CMS gate runs, and the 404 page they render (an agent's Markdown map included) is itself gated as the page the spelling names: the file spelling of a protected page gets the gate's challenge under that 404 status. `/index` is refused the same way.

Exemption is decided by the route Astro matched (`context.routePattern`), not by how the path looks: only the Studio route, endpoint routes under `/api/`, and routes defined as files (`/robots.txt`, `/favicon.ico`, `/sitemap.xml`, `/llms.txt`, `/openapi.json`) skip the gate. `/feed.xml` is the one file route that stays gated (see [RSS feed](./rss-feed.md#basic-auth)). An unknown dotted path such as `/secret.txt` routes to the page catch-all, so it is gated like any page, and so is the 404 page that `/api/<no handler>` renders. A project's own `/api/*` endpoints and file routes are exempt by the same rule with no list to update. Files in `public/` are served by the host before the middleware runs.

An exempt route that throws (Sanity unreachable from `/llms.txt`, `/sitemap.xml` or the favicon, say) answers a plain `503` with `Cache-Control: private, no-store` and `Retry-After: 10`, and the error is logged (`runExemptRoute()` in `src/features/auth/exempt-route.ts`). Left to Astro, the throw would be re-rendered on its `/500` route, which the page catch-all answers, and the gate would challenge it as a page on a locked site. A `500.astro` would not change that: its render passes through the gate as a page too.

Astro's image endpoint, `/_image`, answers **404** under any query (`classifyRequest` in `request-gate.ts`). Nothing renders through `astro:assets`, and the endpoint would otherwise re-serve any same-origin `2xx` body under a type the caller picks, `text/html` included; `astro.config.mjs` also sets `image.service` to `passthroughImageService()`, so it never decodes an image either. A project that adopts `astro:assets` has to undo both: delete that check, so the endpoint is gated like a page, restore an image service, and accept only image formats (`webp`, `avif`, `png`, `jpeg`, `jpg`, `gif`) in its `f` parameter.

## URIs the gate cannot cover

Some URIs name an address the gate cannot check as that page. The Studio's URI field flags them (`uriGateProblem()` in `sanity/schemas/fields/uri-gate.ts`, applied by `createUriField` to every routed type):

- **Whitespace, `%`, a colon, a backslash, or a control character (DEL included).** The router decodes a request path before it matches, browsers read a backslash as a slash, and they strip or rewrite control characters, so the address a page lives at and the address the gate checks could name different pages. A colon can also read as a link scheme (`javascript:`).
- **A dot.** A file-like address is handled as a file, not checked as a page. Here an `.html` or `/index` spelling answers 404 (see **One path per page**), and a file route or a file in `public/` answers in place of the page.
- **A path under `/api`.** Endpoint routes skip the gate.
- **A path starting with `/_`.** That namespace belongs to the framework and the host (`/_astro`, `/_image`, `/_server-islands`, platform endpoints).
- **`/index`.** It is a second spelling of the homepage, which answers 404 rather than a page.

On a page without **Password protect** the rule is a warning, so existing pages keep publishing. Once **Password protect** is on it is an error, because the protection would silently do nothing. The check runs in the Studio only: documents written through the API skip it.

A second rule, also Studio only, refuses an address another route answers first, so the page would never be reached (`reservedRouteIssue()` and `blogRouteIssue()` in `sanity/schemas/fields/create-uri-field.tsx`, always an error): anything under the Studio path, `/404`, anything under `/section-preview`, `/blog/<slug>`, `/blog/authors/<slug>` and the author panel's `/blog/authors/<slug>/modal` for a page or legal page, an article anywhere but `/blog/<slug>`, and a person anywhere but `/blog/authors/<slug>`. A deeper path such as `/blog/authors/jane/cv` is the catch-all's, so a page may use it. Prefixes count by whole segment, so `/studios` and `/section-previews` pass. Nothing leaks through these addresses, since each shadowing route serves only its own content; the rule spares the editor a dead URL.

## The middleware runs often; Sanity calls do not

`src/middleware.ts` runs once per incoming request that is not a cache hit. That is expected: each run is cheap (route and path checks, auth logic).

There is no shared data cache in the middleware, so the auth-state module manages its own caching. The layers that keep Sanity traffic negligible:

1. **Authenticated requests skip Sanity entirely.** Once a user passes the 401 challenge, the browser resends the `Authorization` header without asking on later requests under the directory it was challenged in. A request outside it (under **Protect entire site**, the contact form's post to `/api/` from a page under `/blog/`) gets its own 401 with the same realm, which the browser answers with the credentials it already holds. The middleware validates that header against env credentials first (both halves always compared, in constant time over fixed-length SHA-256 digests); if it matches, the request passes through without ever reading Sanity.
2. **Live Sanity API (no shared cache).** The auth-state query goes to `api.sanity.io`, deliberately not the API CDN. The CDN's publish-driven invalidation misses cached entries whose result set did not yet contain the published document (exactly what happens when a page turns **Password protect** on: it goes from non-matching to matching the query filter), and stale entries were observed serving pre-publish state for 20+ minutes, leaving a newly protected page public. The live API is always fresh; the hot cache below keeps the request volume negligible.
3. **Per-instance hot cache.** Serves repeat requests from memory within a single server instance; see **The gate state** below for how long, and what happens when Sanity cannot be reached.
4. **In-flight deduplication.** If many requests land at once on a cold instance, they await a single shared fetch (with a 5-second timeout so a hung fetch cannot wedge them) instead of each issuing their own query.

The query is pinned to `perspective=published`, so unpublished draft changes can never flip auth on the live site.

### The gate state

`src/features/sanity/proxy-state.ts` holds the last state each instance read, and decides when to read again:

- **A publish forces a fresh read.** The state remembers the content version it was read under (`src/lib/content-version.ts`, bumped by `/api/revalidate` on every publish). When the version has moved, the next caller waits for a fresh read instead of being served the old state, so turning protection on takes effect on the first request after the webhook's settle wait. On Vercel the version is shared by every instance; with the in-process store it only moves on the instance that received the webhook, and the others fall back to the timer below. If that read fails, stale-if-error below applies: the pre-publish state keeps answering, retried every 10 seconds, until a read succeeds or the last good state is an hour old. Protection published during a Sanity outage therefore takes effect when Sanity recovers, not on the next request. Failing closed instead would answer 503 across the whole site on any publish made during an outage, since the version moves on every publish.
- **Otherwise five minutes, then a bounded stale-while-revalidate.** Without a version change (the webhook is not set up, or the version store is unreadable), the state is reused for five minutes. For the 60 seconds after that, the last state is served while one background refresh lands; past that, the caller waits for the refresh.
- **It fails stale, never open.** A refresh that fails is logged (`console.error`) and the last state keeps serving for up to an hour (stale-if-error). Failed refreshes are retried at most once every 10 seconds, so an outage or a rate limit is not hit once per request.
- **No state at all is a 503.** A cold instance that cannot read the state, or one whose last state is more than an hour old, answers **503** with `Retry-After: 10` (the retry backoff) and `Cache-Control: no-store` instead of serving the page, and logs the refusal (`console.error`). A 503 is never stored in the route cache, and the route cache neither serves nor stores a public entry while the state is unknown. This holds for an unprotected site too: during a Sanity outage, a cold instance cannot tell that the site is open.

## Gated pages are still cached

A protected site keeps the same route cache a public one has. The route cache (`src/lib/route-cache/`) lives in the app, past the shared-cache rule that refuses requests carrying an `Authorization` header (RFC 9111), so gated pages are stored and invalidated exactly like public ones: same tags, same webhook, and publishing content refreshes a gated page the same way. See [Revalidation and Caching](../sanity/revalidation-and-caching.md#basic-auth-traffic-is-cached-too) for the mechanics and why sharing an entry between authenticated visitors is safe.

A cache hit answers before the middleware runs, so the route cache checks the same gate state itself. Before it serves or stores a public entry, it looks the canonical path up in the state: a path that is protected now, a locked site, or a state it cannot read means no public read and no public write, and the request falls through to the middleware. An entry stored while a page was still public therefore stops being served the moment the state says otherwise, even before the publish webhook expires it.

## Excluded from Basic Auth

- **Local development.** `astro dev` returns every request unguarded, so no local browsing session, screenshot, or end-to-end run ever meets a 401. The check is `IS_DEV` (`import.meta.env.DEV`), which Vite folds to `false` in a build, so no deployment can take that path: preview deployments gate exactly like production. The gate is a deploy-time concern, and a 401 on localhost mostly breaks the browser rather than testing anything (Chrome drops URL credentials from subresource requests, so the page renders while all of its client JS 401s).
- Sanity Studio at the public path from `PUBLIC_SANITY_STUDIO_BASE_PATH` (see [Studio Config and Structure](../sanity/studio-and-structure.md))
- Endpoint routes under `/api/*` (for example `/api/draft-mode/*` and `/api/contact-form`), decided by the matched route: the 404 page a missing endpoint renders is gated
- Built assets under `/_astro/*` and files in `public/`, which the host serves before the middleware runs (and without its headers, see [Security headers](./security-headers.md#static-files)); a path under `/_astro/` with no file behind it falls through to the catch-all page and is gated like one. Astro's `/_image` endpoint is not exempt: it answers 404
- Routes defined as files (`llms.txt`, `openapi.json`, `sitemap.xml`, `robots.txt`, `favicon.ico`), except `/feed.xml`, which carries article bodies and so follows site-wide Basic Auth. `/llms.txt` and `/openapi.json` index the whole site, so while **Protect entire site** is on their routes answer `404` themselves, with or without credentials (see [llms.txt](./llms-txt.md#basic-auth-and-routing) and [OpenAPI](./openapi.md#while-the-whole-site-is-protected))
- `/api/contact-form` sits under `/api/`, so the middleware skips it, and the endpoint checks the request itself (`readFormPost()`, rules in `src/features/forms/request-guard.ts` and `src/features/api/exact-path.ts`; see [Forms](./forms.md#the-endpoint)). It reads only a post to the exact `/api/contact-form` path, as the URL parser resolves it. While **Protect entire site** is on, a correctly shaped post without the credentials or a signed preview session gets the pages' `401` Basic challenge when `BASIC_AUTH_*` credentials are configured. It answers `503` when the lock state cannot be read, or when the lock is on and no credentials are set, and `400` to everything else it refuses (another spelling of the path, another content type, a body over 64 KB).
- Requests carrying a signed Studio preview session (`__draft_session`), except on the section preview, which is always gated

## Sitemap

URLs with **Password protect** (HTTP Basic Auth) on any routed entry are **omitted** from the generated sitemap (alongside `noIndex`) via the GROQ filter behind `src/pages/sitemap.xml.ts` (`passwordProtected != true`). While **Protect entire site** is on, `/sitemap.xml` answers an empty `<urlset>`, so a locked site does not publish its page list; an unreadable gate state counts as locked. Neither empty answer is cached, so the full list returns on the first request after the site is unlocked.

## Implementation reference

| Concern | Location |
| --- | --- |
| Middleware | [`src/middleware.ts`](../../src/middleware.ts): the request pipeline only, in order: the 404 for `/_image`, route exemption and the canonical path (read from the path as the URL parser resolves it, a 400 when it has none), the always-on gate, the 404 for a page's file spelling, the draft-mode bypass (signed session), then the CMS gate, preceded by the agent's Markdown 404 on the 404 page and by the agent Markdown rewrite on a page. An exempt route runs inside `runExemptRoute()` ([`src/features/auth/exempt-route.ts`](../../src/features/auth/exempt-route.ts)), which answers a throw with a logged `503`. Also sets the response headers (see [Security headers](./security-headers.md)) |
| Request decision | [`src/features/auth/request-gate.ts`](../../src/features/auth/request-gate.ts): `requestPathname()`, the one path input, and what the middleware does with a request before any state is read (exempt, 400, section preview, 404, or gate this page path); pure and tested with every bypass spelling |
| Canonical path | [`src/features/auth/canonical-path.ts`](../../src/features/auth/canonical-path.ts): `canonicalRequestPath()` for a request, `canonicalUri()` for a stored `uri.current`, `decodeRequestPath()` for the router's own view (the route cache key) |
| Route exemption | [`src/features/auth/excluded-paths.ts`](../../src/features/auth/excluded-paths.ts): `isExcludedPath(routePattern, studioBasePath)`, by matched route, and the one file route that stays gated |
| Gates | [`src/features/auth/gates.ts`](../../src/features/auth/gates.ts): the always-on gate and the CMS gate, `IS_DEV` bypass (dev server only), early exit on a valid `Authorization` header, the 503 when no state can be read |
| Gate state | [`src/features/auth/basic-auth-state.ts`](../../src/features/auth/basic-auth-state.ts) (query, canonical path set, `isProtectedPath()`) and [`src/features/auth/sanity-basic-auth-proxy.ts`](../../src/features/auth/sanity-basic-auth-proxy.ts) (`getSanityBasicAuthState()`, `isPublicPath()` for the route cache, `isSiteLocked()` for the sitemap) over [`src/features/sanity/proxy-state.ts`](../../src/features/sanity/proxy-state.ts) (live API, hot cache, content version, stale-if-error, retry backoff, dedupe) |
| Credential helpers | [`src/features/auth/basic-auth.ts`](../../src/features/auth/basic-auth.ts): header decode, constant-time compare over SHA-256 digests (`timingSafeEqual`, also used for secrets), the 401 challenge, and the expected `Authorization` header the route cache provider matches against |
| Environment | [`src/lib/env.ts`](../../src/lib/env.ts): `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` |
| CMS fields | **Settings** (Security tab) → `basicAuth.siteWideEnabled`; **Page** / **Legal page** / **Article** / **Blog** → `passwordProtected` + `uri` |
| Studio URI rule | [`sanity/schemas/fields/uri-gate.ts`](../../sanity/schemas/fields/uri-gate.ts): `uriGateProblem()`, which `createUriField` applies as a warning, or an error under **Password protect** (see **URIs the gate cannot cover**) |
| URI rule tests | [`sanity/schemas/fields/uri-gate.test.ts`](../../sanity/schemas/fields/uri-gate.test.ts): the addresses the rule passes and the ones it flags |

### GROQ query used by the middleware

Published documents only (the request pins `perspective=published`, so drafts are not visible):

```groq
{
  "basicAuth": *[_id == "siteSettings"][0].basicAuth{
    siteWideEnabled
  },
  "protectedPaths": *[passwordProtected == true && defined(uri.current)].uri.current
}
```

The settings singleton is read by `_id` (`SANITY_SINGLETON_SITE_SETTINGS_ID`), so a second document of the same type can never stand in for it.

## Where this is documented in the repo

- **[`docs/README.md`](../README.md)**: Security and access, common tasks, feature docs
- **[`src/features/auth/sanity-basic-auth-proxy.ts`](../../src/features/auth/sanity-basic-auth-proxy.ts)**: GROQ fetch (live Sanity API, published perspective), hot cache tied to the content version, stale-if-error, in-flight dedupe
- **[`docs/features/security-headers.md`](./security-headers.md)**: frame protection and the Report-Only CSP the middleware sends
- **[`docs/sanity/schema-and-content-model.md`](../sanity/schema-and-content-model.md)**: `siteSettings.basicAuth`, `passwordProtected` on routable documents
- **[`docs/sanity/project-setup.md`](../sanity/project-setup.md)**: the wizard does not set `BASIC_AUTH_*` (add manually if needed)
