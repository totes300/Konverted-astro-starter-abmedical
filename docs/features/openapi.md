# OpenAPI document and API error shape

`/openapi.json` serves an OpenAPI 3.1 description of the site's public machine surface, so agents can discover what is callable without scraping. The document is built by `src/features/api/openapi.ts` (framework-free, tested in `src/features/api/openapi.test.ts`) and served by `src/pages/openapi.json.ts`.

## What it covers

The read-only public surface: Markdown content negotiation on every page URL (`getPageMarkdown`), `/llms.txt`, `/sitemap.xml`, `/robots.txt`, and the document itself.

Deliberately excluded: Studio-authorized tooling (`/api/agents/*`, `/api/seo-screenshot`), the revalidation and cache-purge endpoints, Draft Mode, and `/api/contact-form`. The first four are not callable by an outside agent; the contact endpoint is a same-origin form target whose spam defenses assume a browser, and advertising it to automated callers works against that. Add an entry when you expose a genuinely public endpoint.

Every operation has a unique `operationId`, a summary, a description, typed parameters and response schemas, so the document maps cleanly onto LLM function-calling formats.

The title, contact name and the lead sentence of the description come from the **Site singleton** (name and SEO description), so a fresh clone describes its own site rather than carrying someone else's copy. The entry is cached with the site-wide tags, so publishing Site refreshes it.

## While the whole site is protected

`/openapi.json` names the site and points agents at its page index, so while **Protect entire site** is on (`siteSettings.basicAuth.siteWideEnabled`) it answers `404` with the shared error body (`code: "not_found"`), with or without credentials, exactly like `/llms.txt`. The middleware exempts routes defined as files, so the route reads the switch itself (`SiteLockedQuery` in `src/features/agents/query.ts`) from the published Settings document. Settings carries one of the site-wide tags, so publishing it flips the answer on the first request after the webhook's three-second settle wait. With per-page **Password protect** only, the document stays public: it lists endpoints, not pages.

## Error shape

API endpoints return errors as JSON with a shared shape (`src/features/api/errors.ts`, `ErrorResponse` in the document):

```json
{ "error": "Invalid preview secret.", "code": "invalid_preview_secret", "hint": "Open preview from the Studio's Presentation tool so the URL carries a fresh signed secret." }
```

`error` is the human-readable message, `code` a stable machine slug, `hint` an optional resolution pointer. The Studio-backed endpoints (`authorizeStudioRequest` included) and the webhook endpoints (`/api/revalidate`, `/api/cache-purge`) all answer this shape. Two deliberate exceptions: `/llms.txt` answers a plain-text `Not found` because it is a `text/plain` artifact, and `/api/agent-markdown/*` answers a Markdown recovery map, because a Markdown client should not have to parse JSON to learn it took a wrong turn.

`/api/contact-form` answers `{ ok: false, error?, fieldErrors? }`, which the browser form switches on (see [Forms](./forms.md#the-endpoint)); under **Protect entire site** a post without credentials gets the pages' plain-text `401` Basic challenge instead. The `info.description` of the document names these exceptions, so an agent reading it is not told every `/api/*` error is an `ErrorResponse`.

## Keeping it honest

The document is hand-maintained. When a public endpoint is added, removed, or changes its parameters or response shape, update `src/features/api/openapi.ts` in the same change; the tests enforce structure (unique ids, descriptions, resolvable `$ref`s) but not completeness.
