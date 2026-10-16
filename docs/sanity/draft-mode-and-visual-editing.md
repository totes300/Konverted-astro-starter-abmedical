# Draft Mode and Visual Editing

Live preview is powered by `@sanity/astro` + `@sanity/preview-url-secret`. It relies on on-demand rendering: a page reads the preview cookies per request and returns draft content only under a verified preview session.

## Endpoints

File-based routes under `src/pages/api/draft-mode/`, served at `/api/draft-mode/*`:

- Enable draft mode: `src/pages/api/draft-mode/enable.ts`. Refuses any spelling of its path that does not resolve to the exact `/api/draft-mode/enable` (`isExactRoutePath()`, `src/features/api/exact-path.ts`) and a secret that does not have the shape the Studio generates (the bad-secret 401 for both, before any Sanity read), validates the signed preview secret (`@sanity/preview-url-secret`) with `SANITY_API_VIEW_TOKEN` (when Sanity does not answer that read, an uncached `503` with code `preview_unavailable` and `Retry-After: 10`; when it refuses the view token with a 4xx other than 408 or 429, a `500` with code `preview_misconfigured` and no retry; either way `previewCheckFailed()` in `src/features/auth/preview-check.ts` logs the error's name, status and network code, never the error itself, whose message can quote the request URL and so the secret), sets the Presentation perspective cookie (`sanity-preview-perspective`) and the signed httpOnly `__draft_session`, and redirects to the requested page. The perspective cookie is readable and settable by any client, so on its own it proves nothing (see [Studio API auth](../features/studio-api-auth.md)).
- Disable draft mode: `src/pages/api/draft-mode/disable.ts`. Clears both cookies and redirects to `redirectTo` (defaults to `/`).

### Rate limit the handshake

`/api/draft-mode/enable` needs no credentials to call, and every request carrying a well-formed preview secret spends one live Sanity API query authenticated with `SANITY_API_VIEW_TOKEN` before the secret is found invalid. Before launch, add a Vercel Firewall rule:

| Field     | Value                                                         |
| --------- | ------------------------------------------------------------- |
| Condition | Request path contains `draft-mode` **and** ends with `enable` |
| Action    | Rate limit, fixed window, keyed on IP, respond `429`          |
| Limit     | 30 requests per 60 seconds                                    |

The endpoint answers every spelling of its path that does not resolve to the exact `/api/draft-mode/enable` (`/api/draft-mode//enable`, `/api/draft%2Dmode/enable`, a trailing slash) with the bad-secret `401`, before any Sanity read (`src/features/api/exact-path.ts`). But the URL parser resolves dot segments and backslashes before the endpoint sees the path, and the platform may resolve them before routing, so `/api/./draft-mode/enable` or `/api/draft-mode/./enable` reaches the endpoint as the exact path while a "starts with" or "equals" rule on the path as sent misses it. Every spelling the endpoint reads still contains the literal `draft-mode` and ends with the literal `enable`, so this rule counts each one, and the `draft-mode` condition keeps a page whose path ends in `enable` out of the limit. `/api/draft-mode/disable` spends no Sanity read and needs no rule.

An editor opening Presentation or **Open draft page** makes one request each time, far below the limit. Never give `/api/revalidate` or `/api/cache-purge` a rate limit of their own: a burst of publishes can exceed it, and a webhook answered with `429` leaves published content stale.

### Redirects stay on the site

Both routes redirect through `safeRedirectPath()` (`src/features/auth/draft-session.ts`), which resolves the target against the request's own origin and falls back to `/` for anything that would leave it: an absolute or `javascript:` URL, a protocol-relative `//host`, a backslash (browsers read it as `/`), a control character such as a tab or newline (the URL parser strips it, so `/\t/host` would become `//host`), and a path that normalizes to `//host` (`/.//host`, `/a/..//host`). The preview pathname is checked after `validatePreviewUrl` normalizes it, since a valid secret does not make the pathname safe.

### The draft session cookie

`__draft_session` is an expiry signed with HMAC-SHA256. The HMAC key is derived from `SANITY_API_VIEW_TOKEN` with HKDF under a versioned label, so the cookie is never keyed with the token itself, and changing the label invalidates every issued session at once. A session is valid for 12 hours; one whose expiry is later than a fresh session's (plus 60 seconds of clock skew), or whose expiry is spelled any way but plain digits, is rejected even with a correct signature.

## Runtime Wiring

In `src/layouts/Web.astro`:

- `isDraftMode(Astro)` (`src/sanity/lib/draft-mode.ts`) requires a verified signed session (`Astro.locals.draftSession`, set once per request by `src/middleware.ts`) and then reads the perspective cookie
- When enabled, the layout renders:
  - `<VisualEditing />` from `@sanity/astro/visual-editing` (the click-to-edit overlays)
  - an **Exit preview** link pointing at `/api/draft-mode/disable`, back to the current path; it removes itself when the page is framed (the Presentation tool), so only a standalone draft tab shows it

Editing a field in the Presentation tool reloads the page to pull fresh draft content (Astro has no live re-render API).

## How Preview URLs Are Connected

`sanity.config.ts` -> `presentationTool.previewUrl.previewMode` points to the endpoints from the `sanity/config.ts` seam:

- `/api/draft-mode/enable`
- `/api/draft-mode/disable`

Custom document actions in `sanity/actions.tsx` provide:

- Open draft page (opens the enable endpoint with a fresh preview secret of its own, created per click by `createPreviewSecret`, private to the editor and valid for an hour, rather than the project-wide share-access secret)
- Open live page (opens the disable endpoint with `redirectTo` set to the page's path, with a leading `/` added when the stored URI has none, since both routes only redirect to a path starting with `/`)
- Open in presentation / Open in Structure

## Draft Fetch vs Published Fetch

`loadQuery` in `src/sanity/lib/load-query.ts` controls this:

- Perspective cookie passed in -> `drafts` perspective (or the Content Release ids the cookie carries) with stega encoding, authenticated with `SANITY_API_VIEW_TOKEN` (required; `loadQuery` throws without it)
- None passed -> `published` perspective, no stega

Pages pass the cookie down via `getDraftModeProps(Astro)` (`src/sanity/lib/draft-mode.ts`), which passes it only when the middleware verified a signed `__draft_session` (`locals.draftSession`); the perspective cookie on its own leaves the page on `published`. This lets editors preview draft content while public traffic only ever sees published content.

## Basic Auth interaction

The middleware skips the Basic Auth gate for requests carrying a valid `__draft_session` (a signed Studio preview session), so editors can preview a protected site without entering credentials on every request. The perspective cookie alone does not. See [Basic Authentication](../features/basic-auth.md).

## Draft renders are never cached

A draft session outlives the perspective cookie (12 hours against the browser session), so the session alone has to keep a render out of the route cache. Two layers make sure of it: the route cache skips any request carrying either preview cookie (`src/lib/route-cache/rules.ts`), and pages set their cache through `cacheResponse()` (`src/lib/cache.ts`), which turns caching off under a draft session instead of letting a page's own `cache.set` re-enable what the middleware disabled. A test in `src/lib/cache.test.ts` fails when a page or an endpoint under `src/pages` calls `cache.set` directly.
