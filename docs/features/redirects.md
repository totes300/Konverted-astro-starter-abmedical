# Redirects

This starter includes a redirect system managed in Sanity and baked into the Astro build.

## How It Works

- Redirects are stored in the `Settings` document in Sanity (schema type `siteSettings`)
- They are fetched once at config load by `astro.config.mjs` (`fetchRedirects()`) and passed to Astro's [`redirects`](https://docs.astro.build/en/reference/configuration-reference/#redirects) config
- The fetch is fail-soft: a fresh clone without env (or Sanity unreachable) builds with no redirects instead of crashing

Supported behavior:

- Exact path redirects (`/old-page` to `/new-page`)
- `301` (permanent) and `302` (temporary) status codes

Astro's config-level redirects match exact paths; pattern and wildcard syntax is not supported.

## What the build accepts

Studio validation is UI only (an API write skips it), and one entry Astro or the host rejects fails the whole deploy. So `fetchRedirects()` passes every entry through `toConfigRedirects()` in `scripts/build/cms-redirects.mjs` and drops, with a `[redirects]` line in the build log, anything outside this subset:

- **From** is a plain same-site path: literal segments of letters, digits and `._~-`, no `[param]`, `:param`, wildcards, empty segments, `.` or `..`, and no `%` escape. Astro's router matches the decoded request path against the **From** as written, so a percent-encoded **From** (`/caf%C3%A9`) would never fire; a path with other characters, non-ASCII included, cannot be a **From**.
- **To** is the same kind of path, where `%` escapes are allowed (never an encoded slash, backslash or control character), optionally with a plain query (`/new?ref=old`, no `//` inside it) and a section anchor (`/#contact`, `/about#team`: letters, digits and `._~%-`), or an `https://` URL on the site's own apex or `www` host. Protocol-relative (`//host`), backslash, other schemes (`http:`, `mailto:`, `javascript:`) and other hosts are refused, so a redirect can never send a visitor off the site. An anchor never leaves the browser, so it cannot point the visitor at another site.
- **From** never captures `/api`, the Studio path, or anything under `/_` (framework and host internals), in any letter case.
- **To** never names the **From**'s own address. An anchor never reaches the server, and neither a query, a trailing `/` nor letter case changes what the router matches, so `/contact` to `/contact#form` and `/About` to `/about` would loop.
- Each path is at most 1024 characters.

The settings document is read by `_id`, so a second `siteSettings`-typed document created through the API cannot supply redirects.

The Studio's **From** and **To** fields check the same rules (`sanity/schemas/documents/redirect-path.ts`, with `redirectPatterns: false` in `sanity/config.ts`), so the Studio refuses exactly what the build drops, with a reason per rule: a pattern, a `%` escape, a reserved path, an anchor or query on **From**, an anchor or query outside the plain characters on **To**, a **To** that loops back to **From**. It is stricter in two places. It asks for a leading `/`, so an `https://` destination on the site's own host can only be written through the API, which skips Studio validation (check the build log after an import). It also refuses a duplicate **From**, which the build keeps (the last duplicate wins). `scripts/build/cms-redirects.test.ts` runs a set of entries through both and fails when they disagree.

## Managing Redirects

1. Open Sanity Studio at the public path from `PUBLIC_SANITY_STUDIO_BASE_PATH` (default `/studio`; see [Studio Config and Structure](../sanity/studio-and-structure.md))
2. Go to `Settings` -> `Redirects`
3. Add a redirect:
   - `From`: source path (`/old-page`)
   - `To`: destination path (`/new-page`, or `/#contact` for a section)
   - `Kind`: `301 (Permanent)` or `302 (Temporary)`

## Example

- From: `/about`
- To: `/about-us`
- Kind: `301 (Permanent)`

## Notes

- Redirects are resolved at build time
- Rebuild the app after redirect changes (the **Redeploy site** button next to the field is the placeholder seam for that trigger; see [Revalidation and Caching](../sanity/revalidation-and-caching.md))
- Duplicate `from` values are blocked by Studio validation; an API write can still store one, and the build keeps the last
