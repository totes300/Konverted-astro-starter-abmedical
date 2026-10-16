---
name: server
description: Server-side conventions for Astro API endpoints, which live in `src/pages/api/` (file-based routing, served at `/api/*`). Endpoints export `prerender = false` and a typed `APIRoute`, return JSON through the shared helpers (forms: formOk/formFailed/formRefused with `{ ok }`; API routes: privateJson, with errors as `{ error, code, hint? }` via apiErrorResponse), validate parsed bodies, and gate Studio-triggered callers with `authorizeStudioRequest` (public forms use the request guard, validation and a honeypot instead). Env comes from `src/lib/env.ts` (secrets server-only); email via Resend is best-effort; cached GET endpoints declare tags via `cacheResponse()` from `src/lib/cache.ts`. Use when adding or editing an endpoint or email logic.
---

# Server endpoints

The backend is a handful of Astro endpoints plus framework-free helpers in `src/lib/` and `src/features/`. Everything runs in one on-demand server function (`@astrojs/vercel`, `maxDuration: 60` in `astro.config.mjs`), so every endpoint shares the 60 s cap and each upstream call needs its own timeout.

## Core Rules

- Endpoints live in `src/pages/api/` and are routed by Astro's file-based routing (`src/pages/api/contact-form.ts` serves `/api/contact-form`; rest params like `agent-markdown/[...uri].ts` work as usual).
- Export `const prerender = false` and a typed `APIRoute` (`GET`/`POST`).
- Forms answer `{ ok: true }` or `{ ok: false, error?, fieldErrors? }` through `formOk`/`formFailed`/`formRefused` from `~/features/forms/response`. JSON API routes (the Studio-backed ones and the webhooks `revalidate` and `cache-purge`) answer their payload through `privateJson`, and errors as `{ error, code, hint? }` through `apiErrorResponse`/`internalErrorResponse` from `~/features/api/errors`; `agent-markdown` answers Markdown and the `draft-mode` routes redirect. Parse the body in a try/catch and return 400 on bad input; an unexpected throw is `internalErrorResponse`, a logged 500 with fixed text.
- Status codes: 200 success, 400 validation, 401 unauthorized (a public form under site-wide Basic Auth answers the pages' `basicAuthChallenge()`), 403 a signed-in Studio user without publish access, 404 not found, 422 nothing to generate from, 500 missing config (503 for a webhook or secret-gated endpoint whose secret is unset: `revalidate`, `cache-purge`; for a Studio route when Sanity does not answer the session check; and for a public form that cannot read the site's lock or has no credentials to check), 502 upstream failure, 504 an upstream timeout.
- Gate Studio-triggered endpoints (AI generation, screenshots, redeploy) with `const denied = await authorizeStudioRequest(request); if (denied) return denied;` from `~/features/api/auth`, and call them from the Studio with `useStudioFetch()` (`sanity/lib/studio-fetch.ts`), reading the answer with `readStudioJson()` and `studioFailure()` (`sanity/lib/studio-response.ts`), since a host timeout answers a non-JSON 504. Never gate on `Origin` or `Referer` (see `docs/features/studio-api-auth.md`). Public endpoints (the contact form) are not gated by `authorizeStudioRequest`; they read the body through the request guard (`readFormPost` from `~/features/forms/form-post`: the exact route path, multipart only, a 64 KiB cap, site-wide Basic Auth), which returns either the `FormData` or the `Response` to send back as it is, then the strict honeypot and timing checks (`detectSpam(..., { strict: true })` from `~/features/spam-prevention/utils`), then validation (`contactForm.check`). A public endpoint behind a firewall rate limit refuses every other spelling of its path with `isExactRoutePath()` from `~/features/api/exact-path` (as the contact form and `draft-mode/enable` do), so a rule on its last segment counts every request it reads. Server-written documents get their `_id` from `apiOnlyDocumentId()` (`sanity/constants.ts`).
- Read env from `src/lib/env.ts` (re-exports `astro:env`); secrets are server-only and must never reach the client. Check required env at use and return 500 if missing.
- Build absolute URLs (sitemap `<loc>`, `robots.txt`, agent Markdown links) with `absoluteUrl(path)` from `~/lib/env`, never by concatenating `PUBLIC_SITE_URL`. See `astro`. Escape every value written into XML (a sitemap `<loc>`, feed text) with `escapeXml` from `~/lib/xml`: one CMS URI with `&` would otherwise invalidate the whole document.
- A public file or `/api/` route that lists content (`sitemap.xml`, `llms.txt`, `openapi.json`) lists nothing while the whole site is locked (`isSiteLocked()` from `~/features/auth/sanity-basic-auth-proxy`, or `SiteLockedQuery` beside a cached read): the middleware exempts those routes from Basic Auth.
- Cacheable GET endpoints declare TTL and tags with `cacheResponse(context, …)` from `src/lib/cache.ts` (never `context.cache.set` directly: it would re-enable caching under a draft session), using `CACHE_TTL` and tags from the same file; write endpoints never call it. The `/api/revalidate` webhook invalidates tags (see docs/sanity/revalidation-and-caching.md).
- Side effects like email are best-effort: complete the primary task first, then run the side effect off the response with `waitUntil()` from `@vercel/functions` and a timeout of its own (it shares the function's 60 s), and report success rather than failing the whole request.

## Trigger Conditions

Apply when adding or editing an endpoint in `src/pages/api/`, the auth/env helpers, or Resend email.

## Execution Checklist

1. Create the endpoint file under `src/pages/api/`; export `prerender = false` and a typed `APIRoute`.
2. Respond through the shared helpers above; parse and validate the body, returning 400 on failure.
3. Gate Studio-triggered endpoints with `authorizeStudioRequest`; for public ones, validate and honour the spam checks.
4. Read env from `src/lib/env.ts`; check required values and return 500 if absent.
5. If the response is cacheable, call `cacheResponse(context, { ...CACHE_TTL, tags })` from `src/lib/cache.ts`; never `context.cache.set` directly.
6. Log failures server-side; keep user-facing errors short and free of internals.

## Scope Guidance

- This skill owns endpoint shape, validation, auth, env, email, and endpoint caching.
- Page routes, layouts, and page-level fetching: `astro`.
- Reading Sanity inside an endpoint (settings, recipients): `sanity`.
- The browser side that fetches an endpoint: `custom-elements`.

## Non-Goals

- Exposing a server secret to the client.
- Failing the main task when a best-effort side effect (email) fails.
- Trusting request-body values for recipients or permissions (read them from Sanity, the settings singleton by `_id`, with the view token as `sanityPublishedClient` does).

## Done Criteria

- Endpoint is in `src/pages/api/`, exports `prerender = false` and a typed `APIRoute`, and returns JSON through those helpers with correct status codes.
- Input is validated; Studio-triggered endpoints are gated by `authorizeStudioRequest`, public ones use the request guard and the spam checks.
- Env is read from `src/lib/env.ts` with use-time checks; no secret leaks.

## Reference Files

- `src/pages/api/contact-form.ts`: public endpoint, request guard, honeypot + timing, Zod validation, Sanity write, best-effort Resend email.
- `src/pages/api/agents/llms-txt.ts`, `agents/page-markdown.ts`: Studio AI generation, gated by `authorizeStudioRequest`.
- `src/pages/api/agent-markdown/[...uri].ts`: uncached GET (via `serveAgentMarkdown`); re-checks the eligibility allowlist before any read, fails closed, and serves the stored Markdown minus links to pages gated now. Never route-cache it: its answer follows the eligibility snapshot, which no tag busts.
- `src/pages/api/revalidate.ts`: signed Sanity webhook, tag invalidation (logic and tests in `src/features/api/revalidate.ts`).
- `src/pages/api/cache-purge.ts`: empties the whole route cache; bearer-authenticated with `SANITY_REVALIDATE_SECRET` (logic and tests in `src/features/api/cache-purge.ts`).
- `src/pages/api/draft-mode/enable.ts`, `disable.ts`: preview cookie handshake (redirects kept on this origin by `safeRedirectPath()`; `enable` refuses other spellings of its path and a secret of the wrong shape before any Sanity read).
- `src/pages/api/agents/image-alt-text.ts`, `src/pages/api/seo-screenshot.ts`: the other Studio-triggered endpoints.
- `src/features/api/auth.ts`: `authorizeStudioRequest`, the Studio gate (verified Sanity session plus publish access, read from the documented Access API; core in `studio-auth.ts`).
- `src/features/api/errors.ts` (`privateJson`, `apiErrorResponse`, `internalErrorResponse`), `src/features/forms/form-post.ts` and `request-guard.ts` (the public form guard), `src/features/api/exact-path.ts`.
- `.agents/skills/security-audit/SKILL.md`: what every new endpoint is checked against (abuse, timeouts, the firewall rules).
