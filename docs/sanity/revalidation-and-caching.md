# Revalidation and Caching

This stack caches rendered routes with **tag-based invalidation**, built on Astro's route caching API (`Astro.cache` / `context.cache`, configured in `astro.config.mjs`). A signed Sanity webhook at `/api/revalidate` invalidates the right tags on publish, so cached pages refresh about three seconds after content changes while normal traffic is served from the cache. The app answers every cache lookup itself (`src/lib/route-cache/`); no CDN in front of it ever holds a copy. Where entries are *stored* is the one host-specific part: on Vercel it is the Runtime Cache, shared by every instance, and anywhere else it is an in-process store. A deploy empties either one.

## The tag model

Tags follow one convention, shared by the pages that set them (`src/lib/cache.ts`) and the webhook that busts them:

| Tag | Example | Set on |
| --- | --- | --- |
| Document `_type` | `page`, `article`, `site`, `siteSettings` | Every response rendered from that type |
| `doc:<publishedId>` | `doc:homepage` | The document's own routes |
| The routed `uri` | `/about` | The document's page |

Two structural rules make the model work:

- **Every page also carries both site-wide singletons.** The header, footer, and SEO fallbacks come from the Site singleton, and the favicon comes from Settings; all of them render on every page, so each page response is tagged with both `_type`s (`SITE_WIDE_CACHE_TAGS` in `src/lib/cache.ts`). Publishing either singleton therefore invalidates the whole site through one tag.
- **List-like routes carry every contributing type.** `sitemap.xml` is tagged with every routed type (`page`, `legalPage`, `article`, `person`, `blog`) and both site-wide types, so any routed document's publish refreshes it. The blog index adds `article` and `articleCategory` on top of its own document tags, so publishing any post or category refreshes the listing. `llms.txt` carries the same set as the sitemap (its content lives on `siteSettings`, which is one of the site-wide types), so a publish that protects a page also drops that page's link from the served file.

Where tags are set: `src/pages/[...uri].astro`, `src/pages/blog/[slug].astro`, `src/pages/blog/index.astro` and the author pages (`cacheResponse(Astro, …)` from `src/lib/cache.ts`, with `CACHE_TTL` and `docCacheTags(page)` + `SITE_WIDE_CACHE_TAGS`; no page or endpoint calls `cache.set` itself, and `src/lib/cache.test.ts` fails if one under `src/pages` does), plus `src/pages/llms.txt.ts`, `src/pages/sitemap.xml.ts`, `src/pages/feed.xml.ts`, `src/pages/openapi.json.ts` and `src/pages/favicon.ico.ts`, which call the same `cacheResponse(context, …)`. The agent-Markdown route is not cached: its answer depends on the eligibility snapshot, which no tag tracks.

## The provider

`astro.config.mjs` points Astro's cache API at `src/lib/route-cache/provider.ts`. Every lookup is **answered by the app**: rendered responses go into a `RouteCacheStore`, the app reads them back itself, and no response ever carries a header that would let a CDN or any other shared cache downstream hold a copy. That is deliberate. Invalidation is the webhook expiring tags in the store, and a copy sitting in a cache the webhook cannot reach would outlive every publish. The policy is identical on every host; only the store behind it changes.

| Module | Role |
| --- | --- |
| `provider.ts` | The configured entrypoint: wires runtime env (Basic Auth credentials), the store, the gate state (`isPublicPath()`) and the content version into the policy |
| `create-provider.ts` | The policy: what may be cached, what is bypassed, gated vs public keying, tag invalidation. It does no background work, so a long-lived server and serverless behave identically; the provider tests are the contract for both |
| `rules.ts` | The bypass predicates and the Basic Auth credential match |
| `entry.ts` | Key normalization (the path the router renders plus the query parameters that route reads, `ROUTE_QUERY_PARAMS`), the lifetime rule, and (de)serialization for stored entries |
| `store.ts` | The `RouteCacheStore` type (`get` / `set` with ttl+tags / `delete` / `expireTag`) and the in-memory LRU + tag-index default |
| `vercel-store.ts` | The same four methods against Vercel's Runtime Cache, plus the build marker the partition keeps there and the content version's store |
| `build-partition.ts` | Store decorators that key and tag entries by build, and sweep the previous build's entries once the new one serves |
| `content-version.ts` | The content version policy: `read` / `readFresh` / `bump` over the store, and `CONTENT_VERSION_PARAM` (see **The Sanity CDN**) |

Requests the middleware (`src/middleware.ts`) must handle specially skip the cache entirely:

- **Draft mode** (the signed `__draft_session` cookie or the `sanity-preview-perspective` cookie; a forged one only costs its sender the cache): editors always see fresh draft renders. The session cookie counts on its own because it outlives the session-scoped perspective cookie and still skips Basic Auth, so without it a page's own cache call would store a draft session's render as public. Pages set their cache through `cacheResponse()` (`src/lib/cache.ts`), which turns caching off under a draft session rather than re-enabling it after the middleware's `cache.set(false)`.
- **Agent Markdown negotiation** (`Accept` mentions markdown): the middleware's rewrite must run; a cached HTML hit would answer first.
- **Unmatched `Authorization` headers** (wrong password, unrelated Bearer token): the middleware decides, and nothing is stored.

Everyone else gets the cached fast path: `X-Astro-Cache: HIT|MISS` on every cacheable response. Only a plain `200` that sets no cookie and has a body under 1&nbsp;MB is stored. Cookies written through `Astro.cookies` become `Set-Cookie` headers only after the provider returns, so `entry.ts` reads them off the response itself. Bodies travel base64-encoded (`entry.ts`) because `/favicon.ico` is bytes.

Entries are keyed on the path the router renders, not on the request's spelling: decoded as the router decodes it, doubled slashes collapsed and the trailing slash dropped, so `//about`, `/ab%6fut` and `/about/` share `/about`'s entry, and the host is not part of the key. A spelling the router and the gates could read differently (`%2F`, `%25`, a backslash) is never cached.

Only the query parameters a route reads are part of its key, listed per path in `ROUTE_QUERY_PARAMS` (`src/lib/route-cache/entry.ts`); today that is `category` on `/blog`. Tracking parameters (`utm_*`, `gclid` and the like) are dropped on every route, and a listed parameter's values are deduped and sorted, so order or repetition cannot mint entries. Any other parameter means the request still renders but is never stored: it is refused rather than dropped, so a route that starts reading one can never be answered from an entry keyed without it. A query with more than 16 values or a value over 100 characters is not stored either. **This list is the extension point:** a page that starts reading a new parameter adds it there, or every request carrying it renders uncached.

A route can also decline to store one render: `cacheResponse(Astro, false)`. The blog index does that unless every requested category is a known one in its canonical spelling (`isCacheableCategoryView` in `src/features/blog/category-view.ts`), so a made-up `?category=` value renders the empty state without becoming an entry. Each of those decisions has to run in the page's frontmatter: the provider reads the cache options once the page returns its response, before the components below it have rendered, so the blog index reads its article list itself and hands it to `ArticleList`.

### Basic Auth traffic is cached too

Shared caches refuse any request carrying an `Authorization` header (RFC 9111; every CDN applies it), which is one of the reasons the store lives in the app, past that rule. Gated traffic is cached with two safeguards:

- **Separate keyspaces.** Gated entries are stored under a `gated:` key prefix and public entries under `public:`, so a stored gated render can never be read by a request that has not matched the credentials. Before a public entry is served or stored, the provider checks the published Basic Auth state on the request's canonical page path (`isPublicPath()`, the state the middleware reads): a path that is protected now, a locked site, or a state it cannot read means no public read and no public write, so the request reaches the middleware and gets its 401 or 503, which is never stored.
- **Exact credential match.** A request only counts as gated when its `Authorization` header matches `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` exactly, compared in constant time over fixed-length SHA-256 digests (`rules.ts`, on the helpers in `src/features/auth/basic-auth.ts`). A browser replays that identical header on every request after the 401, so an entry is only ever handed back to a visitor already through the gate. Note that the key carries no trace of the credentials themselves: rotating `BASIC_AUTH_PASSWORD` does not orphan entries written under the old one, it just means only holders of the new password can reach them. Either way the redeploy that applies the new env var leaves them behind, since a new build reads a fresh keyspace.

A hit answers before the middleware runs, so protection changes do not rest on invalidation alone. Turning **Password protect** on publishes that document and busts its tags, and **Protect entire site** lives on Settings, whose tag every page carries. The same publish moves the content version, so the next gate-state read fetches fresh, and the provider's own state check stops serving a public copy of a page the state now protects even if no tag reached it.

### Where entries are stored

`provider.ts` picks the store at startup from one flag, `ROUTE_CACHE_VERCEL_RUNTIME` (a boolean, so only `true` or `false`; defaults to `false`):

- **`true`, on Vercel: the Runtime Cache** (`vercel-store.ts`, on `getCache()` from `@vercel/functions`). One cache for the whole project, shared by every function instance, so the webhook's `expireTag` reaches every copy at once. Vercel documents it as **persistent across deployments**, which is what makes it shared rather than what makes it stale: every key carries the build id that wrote it (see below), so what outlives a deploy is the shared store, never the HTML a previous release rendered. It is also split per environment, so preview/staging never reads production's entries, and per project on Pro and Enterprise plans (on Hobby, all of a team's projects share one cache and one storage budget).
- **`false`, the default: the in-process LRU** (`store.ts`). Per process, so a deployment running several instances has one store each and the webhook only expires tags on the instance that receives it; the others keep their copy until that instance is recycled. A deploy or restart starts empty. This is what dev, `astro preview`, and any non-Vercel host use.

It is an explicit flag rather than a sniff of Vercel's own `VERCEL` variable so that a build behaves the same wherever it runs, and so switching hosts is a config change rather than a code change. It is read at runtime (not inlined at build), which is what keeps `vercel deploy --prebuilt` from baking the local machine's value into the deployment.

Any other shared backend (Redis and friends) plugs into the same four-method `RouteCacheStore` type, and nothing else in the route cache changes.

Two Vercel details worth knowing. Route keys are passed to the Runtime Cache percent-encoded rather than through its default hash, which is only 32 bits wide and would eventually serve one page's HTML under another page's URL. And its limits (2&nbsp;MB per item, 128 tags per item, 256 bytes per tag) sit comfortably above what this app stores: bodies are capped at 1&nbsp;MB before encoding, and a page carries about seven short tags. Entries are evicted least-recently-used when the cache fills, and reads and writes are billed.

Freshness is publish-driven only. Publishing a document expires its tags through the webhook, after its three-second settle wait; nothing expires on a timer except `/robots.txt`, which depends only on env, carries no tags and keeps a one-day `maxAge`. `CACHE_TTL` in `src/lib/cache.ts` sets a nominal year-long `maxAge` because the cache API requires one, so in practice a cached page lives until a publish busts it.

### A deploy starts a fresh keyspace

Surviving a deploy is only wanted for the *store*, not for the entries. Rendered HTML is a function of code and content, so a release carrying new markup makes every cached page potentially wrong, and no tag is invalidated by a deploy. Common practice on every platform is that rendered-output caches do not cross a release (Vercel's own CDN cache key includes the deployment URL, and its ISR content is regenerated for a new deployment) while data caches do.

`build-partition.ts` restores that by keying. Every entry a build reads or writes is prefixed with that build's id, so a new release looks up its pages in a keyspace nothing has written to yet and misses until it has rendered them itself. Document tags are not prefixed, so a publish still expires every copy of a document, whichever build rendered it.

Keying was chosen over purging on purpose. A purge is a single moment, and a release handover is not: the previous deployment keeps serving, rendering, and storing until the alias moves, and on Vercel the new deployment can take its first request (which is when a once-per-build purge would fire) before that. Anything the old deployment wrote after the purge survived into the new release, and with a year-long `maxAge` only a publish would ever have refreshed it. A partitioned keyspace has no such window.

The build id is `__ROUTE_CACHE_BUILD_ID__`, a compile-time constant that `astro.config.mjs` bakes into the bundle through `vite.define`. Vercel's `VERCEL_DEPLOYMENT_ID` would have been the obvious source and is the wrong one: the whole system-variable set is gated behind the project's **Enable access to System Environment Variables** checkbox, so with it off the variable is simply absent and every release would silently share one keyspace. A baked-in constant cannot be switched off from a dashboard, behaves identically on every host, and tracks the thing that actually invalidates cached HTML, which is the code changing rather than a deployment happening. A rebuild of unchanged code gets a new id, and so does promoting or rolling back to an older deployment, which is the safe direction.

Retired entries are swept, not left to age out. Every entry also carries a `route-cache:build:<id>` tag, and a marker in the cache records the build serving now and the one it replaced. On its first read or write, each instance reads the marker: a build it has not seen advances it, and then it expires the previous build's tag. Every instance sweeps, not only the first of a release, because the deployment being replaced keeps storing until the alias moves; a later cold start of the new build catches whatever it wrote after the first sweep. The marker moves before the sweep runs, so a sweep that fails is retried under the same previous build on the next request. `/api/cache-purge` still empties everything, across builds, through the `route-cache:all` tag every entry carries.

What survives a deploy, then, is the *warm store shared across instances*, not stale HTML. The in-process store gives neither: it is per-instance, so the webhook only ever reaches the one that receives it and every new instance starts cold regardless.

## The webhook

`/api/revalidate` (`src/pages/api/revalidate.ts`) checks each delivery in this order, then invalidates `[_type, doc:<id>, uri]` for the published document:

1. `SANITY_REVALIDATE_SECRET` unset (or only whitespace): `503` with code `unavailable`. The answer never names the variable.
2. The signed timestamp (`t=` in the `sanity-webhook-signature` header) must be at most one hour old and at most one minute in the future. Anything else, a missing or malformed header included, is `401` with code `stale_signature`. See **Replay window** below.
3. The signature is checked over the raw body text before anything parses it, and compared in constant time (`verifyWebhookDelivery` in `src/features/api/webhook-signature.ts`). A mismatch is `401` with code `invalid_signature`, so an unsigned body, JSON or not, only ever gets a `401`.
4. The verified text must be JSON with non-empty string `_id` and `_type` fields and, when present, a `uri` that is a non-empty string or `null`. Anything else, text that is not JSON included, is `400` with code `invalid_payload`.
5. It waits 3 seconds (`CONTENT_LAKE_SETTLE_MS`), because Sanity fires the webhook before every Content Lake replica has the change. Only then is the content version bumped, and then the tags expire, whether or not the bump held. The answer is `200`, `{ body, tags }` (the validated projection and the tags it expired), or the `500` below when the bump did not hold.

The wait comes before the bump because the bump sends the next gate-state read and the next render to Sanity: before every replica has the publish, either could read the pre-publish content and keep it under the new version, the gate state for its five-minute TTL and a rendered page until the next publish. A bump that fails (the store did not keep it, see **The Sanity CDN** below, or threw) is reported only after the tags expire, so a broken store never stops content from refreshing; it then answers `500` with code `internal_error` and logs the cause, so Sanity redelivers the publish and the redelivery bumps again. An expiry that throws, or any other unexpected failure, answers the same `500`. A delivery that fails a check never waits, bumps or expires anything.

Every answer is JSON with `cache-control: private, no-store`. Errors use the shared `{ error, code, hint? }` body (`src/features/api/errors.ts`, see [OpenAPI](../features/openapi.md#error-shape)) with fixed text, never the original message. The endpoint checks the secret and passes the wait, the bump and the expiry to `handleRevalidateDelivery` (`src/features/api/revalidate.ts`), which runs the rest; `src/features/api/revalidate.test.ts` sends signed deliveries through it and checks the order, that a lost bump still expires the tags before answering `500`, the `500` on a throwing expiry, and that rejected and malformed deliveries move nothing.

Create the webhook once per project at [sanity.io/manage](https://www.sanity.io/manage) (API, Webhooks):

- **URL**: `<your-site>/api/revalidate`
- **Trigger on**: create, update, delete
- **Projection**: `{_id, _type, "uri": uri.current}`
- **Secret**: the value of `SANITY_REVALIDATE_SECRET` in your deployment environment

`SANITY_REVALIDATE_SECRET` is optional: skip the webhook entirely and the build still passes. Leave it unset and `/api/revalidate` answers 503. Without it, a published change reaches a cached route only on the next deploy, since a new build reads a fresh keyspace. The same applies once the secret is set but the webhook is not yet registered in Sanity, so setting up the webhook is the step that makes publishing live without a redeploy.

When set, the secret must be at least 32 characters (`openssl rand -hex 32`): `astro.config.mjs` declares it with `min: 32`, so a shorter value fails Astro's env validation at build and dev start. `/api/cache-purge` reuses it as its bearer token, so the floor covers that endpoint too.

### Replay window

`@sanity/webhook` on its own accepts any signed timestamp after 2021 and compares signatures with `!==`. A delivery captured once (from a log, a proxy, a misrouted request) would then replay forever, and every replay bumps the content version and expires its tags: a replayed `site` delivery empties every page. So the route enforces freshness itself, and a captured delivery works for at most one hour after Sanity signed it. The window is wide on purpose: Sanity delivers one request at a time, so a bulk publish can sit queued for minutes. Inside the hour, a replay can only repeat an invalidation that already happened.

If deliveries start failing with `stale_signature`, check the server clock first, then the webhook's delivery log in Manage for a backlog older than an hour.

`src/features/api/webhook-signature.test.ts` covers replayed, old, future-dated, malformed, foreign-signed, altered and one-character-off deliveries; `npm test` runs it.

Note: the webhook expires tags in the app's own store. On Vercel that is one shared cache and the call reaches every instance; on the in-process store it only reaches the instance that receives it. See **Where entries are stored** above.

## Clearing the whole cache

Publishing is the normal way to refresh content, and a deploy starts a fresh keyspace on its own. `/api/cache-purge` is the escape hatch for the case neither covers: the cache itself looks wrong and you want everything gone without shipping a release.

```bash
curl -X POST -H "Origin: https://<site>" -H "Authorization: Bearer $SANITY_REVALIDATE_SECRET" https://<site>/api/cache-purge
```

It reuses `SANITY_REVALIDATE_SECRET` rather than introducing a second one. Both endpoints do exactly one thing, bust cache, so sharing the secret grants no capability its holder does not already have: anyone with it can already forge a webhook signature and purge by tag. If you ever want them separated, the endpoint reads one env var and nothing else depends on that choice.

Mechanically it is not a special path through the store. Every stored entry carries `ROUTE_CACHE_ALL_TAG` (`route-cache:all`) alongside its document tags, so purging is the same `expireTag` call every publish makes, just with a tag that matches everything. Gated and public entries go together. It bumps the content version first, so the pages it empties re-render from the live content rather than from what the API CDN held under the old version.

It answers like the webhook, with `cache-control: private, no-store` and the shared error body: `200` `{ purged: "all" }`; `503` with code `unavailable` while the secret is unset; `401` with code `invalid_secret` for a missing or wrong Bearer token (compared in constant time), which purges nothing; and `500` with code `internal_error`, the cause logged, when the bump does not stick or the purge throws. `handleCachePurge` (`src/features/api/cache-purge.ts`) holds that logic, and `src/features/api/cache-purge.test.ts` checks each answer.

Its reach follows the store. On Vercel one call clears the whole environment. On the in-process store it clears **the instance that receives the request**, like the webhook does, so a scaled-out deployment needs one call per instance. Either way a redeploy also empties everything, which remains the guaranteed reset if the endpoint itself is the thing misbehaving.

## The Sanity CDN

Published reads go through Sanity's API CDN in every environment (`src/sanity/lib/client.ts`), and give up after 10 seconds, so a stalled Sanity fails the render rather than holding the function to its 60-second `maxDuration`. A route-cache miss, which after a deploy is every page's first render, reads from the CDN's edge instead of the live API: faster, cheaper (cached CDN responses are not rate limited and sit in the cheap tier; only misses reach the API), and warm across deploys, since the CDN keys on the request rather than on the build.

The CDN is only safe because freshness never depends on it. Sanity invalidates its CDN when content changes, but with no guarantee of when, and the render that follows a publish would store whatever it read for a year. So every published read carries a **content version** as an extra GROQ parameter (`$contentVersion`, which no query uses). The API CDN keys on the full URL, parameters included, and on the POST body for long queries, so a value it has never seen is a miss by construction: that read goes to origin, and every later read under the same version reuses the CDN copy.

The version lives beside the route cache's build marker (`route-cache:content-version` in the Runtime Cache on Vercel, per process elsewhere), outside any build's keyspace and untagged, so a deploy, a sweep and a purge all leave it alone (`src/lib/content-version.ts`, policy in `src/lib/route-cache/content-version.ts`). It changes in exactly two places:

- `/api/revalidate` bumps it after the settle wait and **before** expiring the document's tags. A render that starts between the two steps then reads the new version; the other order would let it store a CDN-stale page that nothing expires again. Ordering alone does not cover a render already in flight when the publish lands, or one that joins a version read still in flight from before the bump: it read the old content, and it can finish after the purge. So the provider takes its baseline before rendering through the same deduped read the render's queries use, so it is never newer than the version they carried, and reads again with `readFresh()` (which never joins a read in flight) before storing, skipping the write when the version moved. The check and the write are not atomic, so it reads fresh once more after the write and deletes the entry if the version moved in between: either that read sees the bump, or the bump, and so the purge, came after the write and removed it.
- `/api/cache-purge` bumps it too, so a suspect cache re-renders from origin rather than from whatever the CDN holds.

A bump writes the new value, then reads it back, and fails when it does not come back: the Runtime Cache swallows its own write errors, and a lost bump that still answered `200` would leave every read on the old version with no retry. The webhook still expires the tags, then answers `500` and Sanity redelivers: until a redelivery bumps, a page that publish expired may re-render from what the CDN holds under the old version, and the redelivery's expiry replaces it. `/api/cache-purge` answers `500` on a lost bump without emptying anything, and is simply run again.

Reads of the version are deduped while one is in flight, so a page render that fans out into a dozen queries costs one store read, but never memoized across requests: only a read already in flight when a bump lands can answer the version from before it, which is why the provider's checks use `readFresh()`.

What it costs: after a publish, each page that publish expires re-renders with every one of its queries missing the CDN once. Pages the publish did not touch stay in the route cache and never re-run their queries. After a deploy, every page renders once from the CDN under the unchanged version. Each route-cache miss also reads the version up to three times (before rendering, before storing, after storing); on Vercel those are billed Runtime Cache reads. Draft-mode reads pin `useCdn: false` and carry no version, so editors always read the live API.

## Where caching also exists

- **Gate state reads.** The Basic Auth and agent-Markdown eligibility reads query the **live** Sanity API behind a per-instance hot cache with in-flight dedupe (`src/features/auth/sanity-basic-auth-proxy.ts`, `src/features/agents/markdown-proxy-state.ts`). Both gate states are tied to the content version, so a publish forces a fresh read on the first request after the webhook's settle wait, and a read already in flight from before the bump is never joined by a request that saw the new version; otherwise five minutes plus a 60-second stale-while-revalidate grace is the propagation ceiling. A failed refresh keeps the last state for up to an hour and is retried at most every 10 seconds, and that includes the read a publish forces: protection published during a Sanity outage takes effect when Sanity recovers. With no state at all, pages answer 503. See [Basic Auth](../features/basic-auth.md#the-gate-state).
- **HTTP cache headers.** No route sends a header that lets a shared cache keep a copy (see **The provider** above); `llms.txt` and `sitemap.xml` live only in the route cache. The agent-Markdown serve route sends `public, max-age=0, must-revalidate` plus `Vary: Accept`, so a shared cache never serves the wrong representation.
- **Sanity API CDN.** Published reads use it in every environment, kept fresh by the content version described above. Draft-mode reads and the preview-url handshake pin `useCdn: false`.

## Redirects Are Build-Time

Redirects are fetched in `astro.config.mjs` (`fetchRedirects()`) and baked into the build.

Implications:

- Updating redirects in Sanity does not hot-update a running server
- A rebuild/redeploy is required for redirect changes to apply. The Settings document's **Redirects** field renders a **Redeploy site** button (`sanity/inputs/redeploy-input.tsx`); it is a placeholder that logs a warning and shows a toast until you wire it through the server: keep your host's rebuild trigger (a Deploy Hook URL, a GitHub `workflow_dispatch` token) in a server-only secret, add a route under `src/pages/api/` (for example `redeploy.ts`) whose first step is `authorizeStudioRequest`, and call that route from `handleRedeploy` with the `studioFetch` that `useStudioFetch()` returns. Never put the hook URL or a token in Studio code or in a `PUBLIC_*` or `SANITY_STUDIO_*` variable: the Studio bundle is public. See [Deployment](../deployment.md#content-freshness).
