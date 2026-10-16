# Studio API auth

Every API route that backs a Studio feature (`/api/agents/llms-txt`, `/api/agents/page-markdown`,
`/api/agents/image-alt-text` and `/api/seo-screenshot`) is callable only by a person signed in to this
project's Studio with publish access. The route asks Sanity who the caller is; it never infers it from the
request. There is no second way in: no shared-secret header opens these routes.

## How it works

1. `sanity.config.ts` sets `auth: { loginMethod: "token" }`. The Studio keeps the session token in
   `localStorage` instead of an httpOnly cookie on `api.sanity.io`, so Studio code can read it. Editors
   sign in again once after this ships.
2. Studio code calls these routes with `useStudioFetch()` or `studioFetch(client, url, init)`
   (`sanity/lib/studio-fetch.ts`), which adds `Authorization: Bearer <token>`.
3. The route's first step is `authorizeStudioRequest(request)` (`src/features/api/auth.ts`, which binds
   `src/features/api/studio-auth.ts` to this project). With that token it asks Sanity two things, in
   parallel:
   - **Can this caller publish content here?** The documented Access API permission list,
     `GET https://api.sanity.io/v2025-07-11/access/project/<projectId>/user-permissions/me`
     ([reference](https://www.sanity.io/docs/http-reference/access-api)). Allowed when it holds
     `sanity.document.filter.mode` in `publish` mode on this project (resourceType `project` and
     resourceId the project id, or no resource fields at all; the built-in administrator, editor and
     developer roles) or `sanity.document.filter` `update` scoped to this project (resourceType `project`,
     resourceId the project id; custom roles). A grant on another project or resource never counts
     (`grantsPublish` in `src/features/api/studio-auth.ts`). The Access API has its own version:
     it does not exist at older content API versions, so it is pinned there rather than read from env.
   - **Is it a person?** `https://<projectId>.api.sanity.io/v<*_SANITY_API_VERSION>/users/me`. Robot tokens
     report `provider: "sanity-token"`, which is not in Sanity's reference docs, so it is used only to
     refuse robots, never to allow anyone.

| Caller | Result |
| --- | --- |
| No token, whatever `Origin`, `Referer` or `Host` say | `401` |
| Token longer than 512 characters or outside the RFC 6750 `b64token` charset | `401`, Sanity never asked |
| Token Sanity does not recognise | `401` |
| Valid Sanity login with no permissions on this project | `403` |
| Project `viewer` (read only) or `contributor` (drafts only) | `403` |
| API (robot) token, even with publish access | `403` |
| Signed-in person with publish access (administrator, editor, developer, or a custom role) | allowed |
| Sanity unreachable | `503`, fails closed, and the cause is logged (`[studio-auth] Sanity did not answer the Studio session check:`, a status or a network code, never the token) |

Verdicts are cached in memory per token for 60 seconds, so a Studio session costs one Sanity round trip
a minute. A removed editor keeps access for at most that long. Allowed verdicts (up to 200) and refusals (up
to 100) live in separate caches, so a flood of junk tokens evicts only other refusals, never an editor's
verdict. A Sanity outage is never cached.

## Responses

The refusals above are JSON with `cache-control: private, no-store`, so no shared cache keeps one, and
so is every answer built with the helpers in `src/features/api/errors.ts`: `privateJson` for a success,
`apiErrorResponse` for an error in the shared `{ error, code, hint }` body. An unexpected failure goes
through `internalErrorResponse`, which logs the original error on the server and answers `500` with code
`internal_error` and fixed text: a message from Sanity or another upstream never reaches the caller, since
it can carry URLs, ids or tokens. Every route above answers its unexpected failures this way.

## Rate limit

A well-shaped token the cache has not seen costs two Sanity calls before it is refused, and the
generation and screenshot routes spend AI credits and Microlink quota. Nothing in the code limits how
often, so before launch add a Vercel Firewall rate limit (fixed window, keyed on IP, respond `429`) for
requests whose `authorization` header starts with `Bearer`, on any path, sized from the heaviest Studio
use (a bulk alt-text backfill). A request without a bearer header costs nothing, so the header picks out
every spelling of every Studio route, and the cache purge's bearer call counts too. Its partner rule,
for a header that does not start with `Bearer`, limits Basic Auth guesses (see
[Basic Authentication](./basic-auth.md#how-it-works)).

## Why the obvious checks fail

- **Origin and Referer prove nothing.** They are request headers. Browsers set them, but curl, scripts and
  servers send any value or none. The previous gate trusted them, and let any request without an `Origin`
  through: every Studio route was open to anyone with curl.
- **"The token is valid" is not enough.** Anyone can create a free Sanity account, and `/users/me` answers
  `200` for that token on any project. What the caller may do on this project is the check, and the
  documented Access API permission list is how to read it.
- **Cookie auth hides the token.** Under the default `dual` login method the session usually lives in a
  cookie on `api.sanity.io`, which this app's server never receives.

## Preview sessions

The Sanity preview cookie (`sanity-preview-perspective`) is a plain cookie: a client can set it by hand.
Its mere presence used to skip Basic Auth and switch rendering to drafts.
Now the draft-mode enable route, after Sanity's signed preview secret validates, also sets
`__draft_session`: an httpOnly expiry signed with HMAC-SHA256, under a key derived from
`SANITY_API_VIEW_TOKEN` with HKDF, valid 12 hours. Only a valid signature counts as a Studio session
(`src/features/auth/draft-session.ts`, checked in `src/middleware.ts`). The disable route clears it and only
redirects to same-origin paths. Details: [Draft Mode and Visual Editing](../sanity/draft-mode-and-visual-editing.md#the-draft-session-cookie).

## Adding a route

```ts
const denied = await authorizeStudioRequest(request);

if (denied) {
  return denied;
}
```

Answer with `privateJson` and `apiErrorResponse`, and end the handler's `catch` with
`internalErrorResponse` (see **Responses** above), never with the caught error's message.

From the Studio: `const studioFetch = useStudioFetch();` then `await studioFetch("/api/my-route", { ... })`.
Outside React, pass the client from `useClient` to `studioFetch(client, url, init)`. Read the answer with
`readStudioJson(res)` and turn a failure into the editor's message with `studioFailure(res, payload, fallback)`
(`sanity/lib/studio-response.ts`): a host timeout answers a plain-text page, not JSON, so a `504` reads as
"The request took too long. Try again." instead of a parse error.

## Scripting

Send your own Sanity login as a bearer token (`npx sanity login`, then `npx sanity debug --secrets`
prints it). API tokens are refused on purpose.

## Keep the origin free of untrusted script

The session token sits in `localStorage` on the site's origin, so any script running on that origin could
read it. Never render editor or visitor HTML unescaped on the same origin as the Studio.

## Tests

`src/features/api/studio-auth.test.ts` covers every row of the table above with a mocked Sanity, plus the
cache split (500 rejected tokens, then the editor's call still answered from cache) and the project scoping
of grants. `src/features/api/errors.test.ts` covers the private headers and the fixed error text,
`src/features/auth/draft-session.test.ts` the preview session, and `sanity/lib/studio-response.test.ts` the
Studio's reading of a non-JSON answer. Run them with `npm test`.
