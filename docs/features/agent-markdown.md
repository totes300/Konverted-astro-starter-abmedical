# Agent Markdown (content negotiation)

Public pages (pages, legal pages, articles, author pages and the blog index) can serve a token-light **Markdown** version of themselves to AI agents, on the **same URL**, through HTTP content negotiation. When an agent fetches a page with an `Accept: text/markdown` header, it gets clean Markdown instead of the full HTML document; a browser asking for `text/html` gets the normal page. Markdown is far cheaper for a model to read (the [Sanity field guide](https://www.sanity.io/blog/how-to-serve-content-to-agents-a-field-guide) measures up to a ~97% token reduction versus rendered HTML), and some agents (for example Claude Code) skip their summarization step entirely when a response is already `text/markdown`.

The Markdown is a **stored, editable field**, not something computed on every request. In the Studio you click **Generate** to draft it from the document's current content, review or tweak it, and **Publish**; the frontend then serves that published field verbatim. This mirrors [`/llms.txt`](./llms-txt.md): llms.txt is a curated, site-wide index; agent Markdown is the per-page body an agent reads after following a link. Both are "generate once, store, serve the field" surfaces, grouped under an **Agents** tab.

- **It is on by default** for every routed document (Page, Legal page, Article, Person, Blog), but a page serves Markdown only **after** its `agentMarkdown.content` has been generated and published. Until then, agents get HTML.
- **Generate it per page:** Studio, the document's **Agents** tab, **Generate**. It writes the Markdown into the editable **Content** field.
- **Or fill every missing page at once:** Studio, **Settings**, **Agents** tab, **Backfill**. See [Backfill](#backfill).
- **Turn it off per page:** Studio, the document's **Agents** tab, **Serve Markdown to agents** off.
- **It is served at the page's own URL** via the `Accept` header; there is no separate `.md` URL to link.
- **It does not refresh on its own.** Edit the page and the stored Markdown drifts until you click **Generate** again and publish. This is intentional (editorial control), the same as llms.txt.

## How it works

```
Studio (author)                                       Frontend (agent request)
┌─────────────────────────┐                           ┌────────────────────────────┐   ┌───────────────────────────┐
│ Agents tab → Generate   │  middleware (every req)   │ prefersMarkdown(Accept)?   │   │ /api/agent-markdown/about │
│  POST /api/agents/      │  ┌───────────────────┐    │  no  → normal HTML + auth  │   │  read stored              │
│    page-markdown        │  │ GET /about        │───▶│  yes → eligible? (cached)  │   │  agentMarkdown.content    │
│  → pageToMarkdown()     │  │ Accept:           │    │        └ rewrite ──────────┼──▶│  → text/markdown + Vary   │
│  → set() into Content   │  │   text/markdown   │◀───┤                            │   └───────────────────────────┘
│  → author publishes     │  └───────────────────┘    └────────────────────────────┘
└─────────────────────────┘
```

**Generate (author, once per meaningful change).** The **Content** field's input (`AgentMarkdownInput` in `sanity/inputs/generate-text-input.tsx`) POSTs the page URI to `/api/agents/page-markdown` (`src/pages/api/agents/page-markdown.ts`). That endpoint fetches the document by URI under the `drafts` perspective, serializes its body with `pageToMarkdown` (deterministic, no AI): a page's page builder, an article's `content` rich text, a legal page's content, a person's bio, the Blog index's article list, and returns the text; the input writes it into `agentMarkdown.content` with `onChange(set(...))`. The author reviews and **publishes**. Nothing is served until publish.

**Serve (agent, per request).**

1. A request arrives. `src/middleware.ts` hands it to `rewriteToAgentMarkdown` (`src/features/agents/markdown-rewrite.ts`), which calls `prefersMarkdown(Accept)`. Browsers never list `text/markdown`, so this returns `false` immediately and the request follows the existing HTML + Basic Auth path with **zero** added work.
2. For an agent that does prefer Markdown, the middleware reads a small, cached **eligibility** state (`getAgentMarkdownState`) and, if the path is on its allowlist (see [Eligibility](#eligibility)), calls `context.rewrite()` to the internal Markdown route. The URL the agent sees stays `/about`. If the state cannot be read, nothing is rewritten and the request continues to the HTML page and its Basic Auth gate.
3. `src/pages/api/agent-markdown/[...uri].ts` hands the request to `serveAgentMarkdown` (`src/features/agents/serve-agent-markdown.ts`). The middleware skips every `/api/` path, so anyone can request this route directly; it therefore checks the same allowlist itself, **before** any Sanity read, and answers `404` when the URI is not on it, when the whole site is behind Basic Auth, or when the eligibility state cannot be read (it fails closed). Only then does it read the published `agentMarkdown.content` by URI (`AgentMarkdownServeQuery`, which also never matches a password-protected or `noIndex` page) and respond `text/markdown; charset=utf-8` with `Vary: Accept`. It never recomputes the Markdown, but it does drop links to pages that are protected or `noIndex` **now** (`dropGatedLinks` in `src/features/agents/gated-links.ts`, fed from the same snapshot): a list item or reference definition that names such a page goes, wrapped lines included, and elsewhere only the link goes and its text stays; an autolink or a bare URL to it is removed. A link is recognized by its destination, never its text, so brackets in a title, a soft break inside a link or balanced parentheses in a raw URL (`/secret(1)`) cannot hide one, a reference definition is read by its own destination, and the site's apex and `www` host, over `http` or `https`, count as the same site. The stored text is a snapshot, so a Blog index generated before an article was protected would otherwise keep listing it.

### What counts as "prefers Markdown"

`prefersMarkdown` (in `src/features/agents/prefers-markdown.ts`, with its tests beside it) serves Markdown only when the client explicitly accepts `text/markdown` (or `text/x-markdown`) **and** ranks it at least as high as `text/html` by q-value. So:

| `Accept` header                                   | Result                          |
| ------------------------------------------------- | ------------------------------- |
| `text/html,application/xhtml+xml,...` (a browser) | HTML                            |
| `text/markdown` (Claude Code style, no HTML)      | Markdown                        |
| `text/markdown, text/html`                        | Markdown (listed first / equal) |
| `text/markdown;q=0.5, text/html;q=1.0`            | HTML (client prefers HTML)      |
| `*/*` (curl, generic clients)                     | HTML (no explicit Markdown)     |

### Eligibility

The eligibility state is an **allowlist** of canonical page paths (`src/features/agents/markdown-eligibility.ts`, shared by the middleware and the serve route). A route is served as Markdown only when the snapshot lists it and **all** of these hold (otherwise it falls through to normal HTML). A path missing from the snapshot (a page published moments ago, perhaps with protection on, or any other spelling of a page's URL) is never served.

- The site is **not** behind site-wide HTTP Basic Auth (`siteSettings.basicAuth.siteWideEnabled`).
- The page is **not** password protected (`passwordProtected != true`).
- The page is **not** `noIndex` (`seoMetadata.noIndex != true`).
- The per-page switch is on (`agentMarkdown.enabled != false`; **undefined is treated as on**).
- The page **has stored Markdown** (`agentMarkdown.content` is present and non-empty).

When the serve route does answer `404` (a direct hit on a path that is not eligible, or a page whose Markdown was unpublished between the eligibility read and the request), the body is a **Markdown recovery map** (`src/features/agents/not-found-markdown.ts`) pointing at `/llms.txt`, the sitemap and `/openapi.json`, so an agent that took a wrong turn can re-orient instead of parsing a bare error string.

An agent that asks for a path the site does not have (the catch-all found no page, or the path is a page's `.html` spelling) gets the same map with its `404`, from the middleware's pass over the 404 page (`notFoundRender()` and `notFoundMarkdown()` in `serve-agent-markdown.ts`). That answer still goes through the Basic Auth gate, so a locked site or a protected page never gets the map: an unknown path on a locked site answers `401` before the page renders, and a file spelling of a protected page (or of any page while the site is locked) gets the gate's challenge text instead of the map, with the 404 status Astro keeps on a 404-page render. It reads no content and no eligibility snapshot itself, so it adds no Sanity read to the page lookup that found nothing.

The content check is what makes this a pure consume model: until an editor generates and publishes the Markdown, the page is not advertised as Markdown-available, so an agent gets HTML rather than a `404` from the serve route. A disabled, noindex, or ungenerated page keeps serving HTML to agents (the representation they can still accept).

Password-protected, `noIndex` and site-wide-gated pages never reach an agent as Markdown, through the rewrite or a direct request to `/api/agent-markdown/...`: the allowlist leaves them out, and the serve query, which reads the page's current published flags and the site lock on every request, does not match them either. Turning on **Protect entire site** takes effect on the first request after the webhook's three-second settle wait when the revalidate webhook is set up, and otherwise within about five minutes (see [Caching](#caching)), the same as the Basic Auth gate. A protected page may still **hold** Markdown (**Generate** works on it, so it can be prepared before the page goes public); it is simply never served while the page is gated.

## Editing in the Studio

Every routed document (**Page**, **Legal page**, **Article**, **Person** and the **Blog** index) has an **Agents** tab with an **Agent Markdown** object (`createAgentMarkdownField`), beside the **SEO** tab:

- **Serve Markdown to agents**: a switch, on by default. A document saved before the field existed has no stored value, which serving treats as on, so the switch shows it as on too. Turn it off to keep that one page HTML-only for agents.
- **Content**: the Markdown served to agents. Click **Generate** above the field to draft it from the page's current content, then edit if you like and **Publish**. It is **required while serving is on**: a page with the switch on and no Markdown cannot be published.

The site-wide singletons have no per-page object: the site-level equivalent is [`/llms.txt`](./llms-txt.md), configured under the **Agents** tab of the Settings singleton.

> Generation is deterministic. The **Generate** button runs the same `pageToMarkdown` serializer the serve route once ran per request, just materialized into an editable field. No AI is involved, so it is fast and free and never drops or paraphrases content. If you edit the page afterwards, click **Generate** again to refresh the stored Markdown, then publish.

### Reminder on publish

Publishing a page shows an info toast reminding the editor that its agent Markdown may be out of date and pointing at the Agents tab. The Publish action is wrapped (`withAgentMarkdownReminder` in `sanity/actions.tsx`, applied to every type carrying `createAgentMarkdownField`) and the toast fires on every publish, except when **Serve Markdown to agents** is off. It does not compare anything and nothing is regenerated automatically.

### Backfill

Editors forget the Agents tab, so **Settings → Agents → Agent Markdown** has a panel that counts the pages with serving on and no Markdown, and fills them in one go. It runs the same `pageToMarkdown` serializer as **Generate** (no AI, no credits), and:

- writes to the **published** page, so it is served right away, and to a **draft** in progress, each serialized from its own content (a draft would otherwise publish over the filled field and fail validation);
- never overwrites existing Markdown and skips pages with **Serve Markdown to agents** off, and password-protected pages, which are never served (**Generate** on the page itself still works for them);
- fills a page with no content yet with its heading (and description) alone, the same as **Generate** would.

The Blog index's article list is never taken from the read that serialized the page: the backfill reads under `raw` (drafts and release versions are rows of their own) and **Generate** under `drafts` (draft-only articles appear), and the stored text becomes public once published. Both paths replace the list with the published Blog document's own, read under the `published` perspective (`withPublishedArticleLists` in `src/features/agents/published-article-lists.ts`), so no draft or release version ever reaches it, and an index that was never published lists nothing.

The endpoint works through the backlog within a 40s budget per request, inside the function's 60-second `maxDuration`; the panel loops while `remaining` is above zero, and **Stop** aborts the request in flight. From the API:

```sh
# fill every missing page (repeat while `remaining` > 0)
curl -s -X POST https://<your-domain>/api/agents/page-markdown \
  -H "content-type: application/json" \
  -H "authorization: Bearer $SANITY_USER_TOKEN" \
  -d '{"backfill": true}'

# counts only
curl -s https://<your-domain>/api/agents/page-markdown \
  -H "authorization: Bearer $SANITY_USER_TOKEN"
```

Serving changes reach agents on the first request after the webhook's three-second settle wait when the revalidate webhook is set up, and otherwise within about five minutes (the middleware reads the live Sanity API behind a hot cache tied to the content version; see [Caching](#caching)).

## What the Markdown contains

`pageToMarkdown` (`src/features/agents/markdown.ts`) walks the document and emits:

- An `# H1` from the SEO title (falling back to the document title, then a path-derived label, so `/case-studies` becomes "Case Studies").
- For articles, an italic metadata line: author, publish date, categories.
- The SEO description as a lead paragraph.
- For the Blog index, its heading, intro and a linked list of the published articles.
- The document's own rich text body, when it has one: an article's or legal page's `content`, a person's `bio`.
- One fragment per page-builder section.

Sections are serialized **by convention, not by type**: the query and serializer read the standard field-factory names from each section's `sectionContent`, whichever section it is.

| Field                                 | Becomes                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `headline`                            | an `##` heading                                                                                       |
| `appRichText` (`createRichTextField`) | Markdown body: headings, paragraphs, **bold**/_italic_/`code`, lists, links, plus `mediaBlock` images |
| `appMedia` (`createMediaField`)       | `![alt](url)` for images                                                                              |
| `caption`                             | an italic line                                                                                        |
| `appLink` (`createLinkField`)         | a Markdown link                                                                                       |

Links are absolutized against `PUBLIC_SITE_URL`, so a site-relative `/contact` becomes a full URL an agent can follow. Only site-relative links (`/` but not `//`, `?`, `#`) and `http`, `https`, `mailto` and `tel` links survive (`absoluteSafeHref` in `src/features/sanity/link/safe-href.ts`, the same allowlist the page renderers and the RSS feed use); anything else, such as `javascript:` or `data:`, drops the link and keeps its text. Every destination the serializer writes (span links, the section CTA, images, the Blog index's article list) also has `(`, `)`, `[`, `]`, `<`, `>` and whitespace percent-encoded (`markdownHref` in `src/features/agents/markdown.ts`), so a stored URL such as `https://ok.example/a)[x](javascript:alert(1))` cannot close its link early and smuggle a second one in; a balanced URL (`/wiki/Foo_(bar)`) stays one working link, as `%28` and `%29`. A soft break inside linked text becomes a space, so each link stays on one line. Link text is written as stored. Markdown generated before this encoding keeps its text until it is regenerated. The serializer is pure and has no Sanity or env dependency.

### Adding or changing a section

Two layers, tuned in two paired files:

- **Defaults (guaranteed).** Only the page-builder factory fields render by default, because only those names are guaranteed in any project: `appRichText` (`createRichTextField`), `appMedia` (`createMediaField`), and `appLink` (`createLinkField`). Their GROQ aliases live in `FactorySectionContentFragment` (`src/features/agents/query.ts`) and their renderers in `markdown.ts`.
- **Project extension (extend here).** This template's sections also carry plain `headline` and `caption` fields, which are not factory output, so they live in the PROJECT block: `AgentMarkdownSectionContentFragment` adds the aliases, and the PROJECT renderers plus the `sectionRenderers` order add the rendering.

To support any other field (a custom `quote`, an `images[]` array): add an alias in `AgentMarkdownSectionContentFragment`, add a renderer in the PROJECT block, and slot it into `sectionRenderers`. Sections are read as a loose bag of aliases, so there is no type to maintain. The GROQ stays a hand-written static string because typegen cannot resolve a query built from config. The **agent-markdown** skill captures this; **scaffolding-plop** and **sanity** hand off to it when sections change. The block / Portable Text rendering below the renderers is spec-standard and not a tuning point. Non-image media (video, Lottie, Rive) is not serialized today; only its caption carries over.

> Because the Markdown is stored, a section change only reaches agents once an editor **regenerates** each affected page and publishes. New serializer coverage is not retroactive to already-generated pages.

## Caching

The feature is built to **never add cost to normal traffic** and to avoid wasted Sanity reads:

1. **Browsers pay nothing.** `prefersMarkdown` rejects non-agent `Accept` headers before any parsing or network call.
2. **Eligibility is cached like Basic Auth.** `src/features/agents/markdown-proxy-state.ts` mirrors `src/features/auth/sanity-basic-auth-proxy.ts`: a direct live Sanity API read (`api.sanity.io`, `perspective=published`), a per-instance hot cache tied to the content version, with bounded stale-while-revalidate and in-flight deduplication. The publish webhook bumps the version after its settle wait, so the next agent request after the bump waits for a fresh snapshot; the 5-minute TTL is the ceiling only when the version does not move (no webhook, or an instance the in-process version does not reach). It is only ever called for agent requests and direct requests to the serve route, and it is one snapshot for the whole site, so a run of random URIs adds no Sanity read of its own. The API CDN is deliberately not used, because its publish invalidation misses entries whose result set did not yet contain the published document (see [Basic Auth](./basic-auth.md#the-middleware-runs-often-sanity-calls-do-not)). For the same reason the query projects the exclusion flag over the **stable** result set `*[defined(uri.current)]` (every routed doc) and reduces it to an allowlist Set of eligible paths in JS, instead of filtering `*[...predicate...]`: a filtered set changes membership the moment a page is first generated (it gains `agentMarkdown.content`), and even the non-CDN API misses that transition, leaving the page HTML-only for a long time. The stable set busts on any publish and reads fresh.
3. **The content fetch is fresh per request.** The serve route reads the published field through the shared Sanity client, keyed to the content version the publish webhook bumps (see [Revalidation and Caching](../sanity/revalidation-and-caching.md)), so a published change is served from the first agent request after the webhook's three-second settle wait bumps the version. The route is deliberately **not** route-cached: its answer also depends on the eligibility snapshot (the site lock, which pages are gated now), which no cache tag tracks. The response goes out with `cache-control: public, max-age=0, must-revalidate` and `Vary: Accept`, so no shared cache serves a stale copy. The middleware rewrites to a **distinct** internal path (`/api/agent-markdown/...`), so the Markdown variant never collides with the HTML at the original URL, and `Vary: Accept` keeps any shared-key cache from serving it to a browser.

### Why the middleware and not a config-time rewrite

Astro's `redirects` config (and any static rewrite table) is resolved at build time; it cannot match on the `Accept` header per request, let alone consult the per-page toggle, stored-content presence, or protection state in Sanity. The middleware can, and it short-circuits browser traffic for free, so the per-page control and the "never serve protected content as Markdown" guarantee live there.

## Manual verification

Against a deployment (or local dev):

```bash
# Before generating: an agent gets HTML (the page is not yet advertised as Markdown-available).
curl -s -I -H "Accept: text/markdown" https://<your-domain>/about
#   → content-type: text/html

# In the Studio: /about → Agents tab → Generate → Publish. Then:
curl -s -H "Accept: text/markdown" https://<your-domain>/about
#   → 200, content-type: text/markdown; charset=utf-8, starts with "# ..."

# HTML for a browser (same URL):
curl -s -I https://<your-domain>/about
#   → 200, content-type: text/html

# Turn the switch off (Agents tab) on /about and publish, then:
curl -s -I -H "Accept: text/markdown" https://<your-domain>/about
#   → content-type: text/html  (falls back to HTML, never 404)
```

Also confirm a password-protected or `noIndex` page returns HTML (not Markdown) for an `Accept: text/markdown` request, and that a direct request to its serve route answers `404`, even when the page holds stored Markdown:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/api/agent-markdown/<protected-page>
#   → 404
```

## Implementation reference

| Concern                 | Location                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CMS field (Agents tab)  | [`sanity/schemas/fields/create-agent-markdown-field.tsx`](../../sanity/schemas/fields/create-agent-markdown-field.tsx): `agentMarkdown` object (`enabled` switch + `content`) via `createAgentMarkdownField` |
| Generate input (button) | [`sanity/inputs/generate-text-input.tsx`](../../sanity/inputs/generate-text-input.tsx) (`AgentMarkdownInput`): POSTs the URI, writes the result with `set()`                                                                      |
| Generate endpoint       | [`src/pages/api/agents/page-markdown.ts`](../../src/pages/api/agents/page-markdown.ts): deterministic `pageToMarkdown` under the `drafts` perspective, refusing a missing URI or one over 2,048 characters (`400`, `missing_uri`) before any read, then `404` `page_not_found`; also the backfill (`GET` counts, `POST { backfill: true }`) under the `raw` perspective, skipping password-protected pages. Both swap in the published article list ([`published-article-lists.ts`](../../src/features/agents/published-article-lists.ts)) |
| Backfill panel (Settings → Agents) | [`sanity/inputs/agent-markdown-backfill-input.tsx`](../../sanity/inputs/agent-markdown-backfill-input.tsx), hosted by the value-less `agentMarkdown` field in [`site-settings.tsx`](../../sanity/schemas/documents/site-settings.tsx) |
| Publish reminder        | [`sanity/actions.tsx`](../../sanity/actions.tsx): `withAgentMarkdownReminder` wraps Publish on every type carrying the field |
| Content negotiation     | [`src/features/agents/markdown-rewrite.ts`](../../src/features/agents/markdown-rewrite.ts): `prefersMarkdown()` + rewrite to the Markdown route, called from `src/middleware.ts`, which also answers an agent's 404 with the recovery map, behind the gate (`notFoundRender()` in `serve-agent-markdown.ts`, over `isMarkdownRequest()` in `prefers-markdown.ts`) |
| Eligibility rules       | [`src/features/agents/markdown-eligibility.ts`](../../src/features/agents/markdown-eligibility.ts): the state query, `toAgentMarkdownState()` (allowlist of eligible paths, gated paths, site lock) and `isAgentMarkdownEligible()`, checked by both the middleware and the serve route |
| Eligibility cache       | [`src/features/agents/markdown-proxy-state.ts`](../../src/features/agents/markdown-proxy-state.ts): `getAgentMarkdownState()`, tied to the content version, and the internal route base path |
| Content query           | [`src/features/agents/query.ts`](../../src/features/agents/query.ts): `AgentMarkdownContentQuery` (generation), `AgentMarkdownBacklogQuery` / `AgentMarkdownBackfillQuery` (backfill) and `AgentMarkdownServeQuery` (serving, which never matches a gated page or a locked site) |
| Serializer              | [`src/features/agents/markdown.ts`](../../src/features/agents/markdown.ts): `pageToMarkdown()` (pure, section-agnostic)                                                                                      |
| Serve endpoint          | [`src/pages/api/agent-markdown/[...uri].ts`](../../src/pages/api/agent-markdown/[...uri].ts) and [`serve-agent-markdown.ts`](../../src/features/agents/serve-agent-markdown.ts): re-checks eligibility before any read (fails closed), serves the stored field minus links to gated pages ([`gated-links.ts`](../../src/features/agents/gated-links.ts)), `text/markdown`, `Vary: Accept` |
| Link allowlist          | [`src/features/sanity/link/safe-href.ts`](../../src/features/sanity/link/safe-href.ts): `absoluteSafeHref()`, shared with the page renderers and the RSS feed |
| Tests                   | `markdown-eligibility.test.ts`, `markdown-proxy-state.test.ts`, `serve-agent-markdown.test.ts`, `query.test.ts`, `gated-links.test.ts`, `published-article-lists.test.ts`, `markdown.test.ts` and `prefers-markdown.test.ts` in `src/features/agents/` |

## Troubleshooting

| Symptom                                                               | Cause and fix                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent gets HTML, not Markdown                                         | The `Accept` header does not prefer `text/markdown` (it must list it and rank it at least as high as `text/html`); or the page is `noIndex`, password protected, behind site-wide Basic Auth, has **Serve Markdown to agents** off, or has **no generated Markdown yet** (open the Agents tab, click **Generate**, publish). |
| Markdown is stale after editing the page                              | Expected: the stored Markdown does not refresh on its own. Open the Agents tab, click **Generate** again, and publish.                                                                                                                                                                                                       |
| A section change is not reflected                                     | Regenerate each affected page (Agents tab → Generate → Publish). Serializer coverage is not retroactive to already-generated pages.                                                                                                                                                                                          |
| Toggle change not reflected                                           | Publish the document (the middleware reads the published perspective; saving a draft has no effect). With the revalidate webhook set up the first request after its three-second settle wait reads it; without the webhook, allow about five minutes for the middleware's hot cache to roll over.                                                                 |
| Direct hit to `/api/agent-markdown/...` returns Markdown in a browser | Expected for an eligible page: that is the internal route and the content is public. The user-facing URL stays the page URL via the rewrite. A password-protected, `noIndex` or site-wide-gated page answers `404` there.                                                                                                    |
| A link in the stored Markdown is missing from the served Markdown      | The page it links is password protected or `noIndex` now, so serving drops it. Regenerate to update the stored text.                                                                                                                                                                                                       |
| Generated Markdown is only a heading                                  | The document has no body and no page-builder sections, or every section is empty. Only the `# H1` (and description) render, and that is what gets stored and served. Add content, then **Generate** again and publish.                                                                                                                                                    |
