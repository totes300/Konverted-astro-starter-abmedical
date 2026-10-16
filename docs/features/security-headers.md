# Security headers

`src/middleware.ts` sets the response headers below on every response that passes through it, using the values built once in [`src/lib/security-headers.ts`](../../src/lib/security-headers.ts). A route cache hit is answered before the middleware runs, but it carries the headers its entry was rendered with, so cached pages send the same set. Static files never pass through it; see [Static files](#static-files).

## Every rendered response

| Header | Value | Why |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing of responses |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Paths and queries stay on the site |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Nothing on the site uses them |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking protection for older browsers |
| `Content-Security-Policy` | `frame-ancestors 'self' <apex origin> <www origin>` | Enforced: no other site may frame a page, a draft preview, the contact form or the Studio |

The two origins are the apex and `www` host of `PUBLIC_SITE_URL`, with its protocol. The Presentation tool frames the preview from the embedded Studio, which is served by the same deployment (`/studio`), so it keeps working; listing both hosts covers a Studio browsed on `www` previewing `PUBLIC_SITE_URL` on the apex, or the reverse. Browsers that support `frame-ancestors` ignore `X-Frame-Options` when both are present. `frame-ancestors` only works in an enforced policy, which is why it is a separate header from the Report-Only policy below.

Nothing on the site is meant to be framed by another origin. That includes the Studio: opening it inside the sanity.io dashboard, a Studio deployed elsewhere with `sanity deploy`, another domain, or a Vercel preview URL framing production are all refused. To allow one, add its origin to the list `frameAncestors()` returns in `src/lib/security-headers.ts` (for the sanity.io dashboard, `https://www.sanity.io`). In development the origins come from `PUBLIC_SITE_URL` too, so open the Studio on that exact host: a Studio on `127.0.0.1` while `PUBLIC_SITE_URL` says `localhost` is not a listed ancestor of the preview, so Presentation is refused.

## Report-Only Content Security Policy

Every route except the Studio also sends `Content-Security-Policy-Report-Only`. It blocks nothing: violations are logged in the browser console (DevTools, Issues tab). There is no report endpoint. The Studio loads its own set of origins and gets no policy here (see **Not done here**).

The site renders inline scripts without a per-request nonce (the reload stamp, scroll anchors and draft-mode exit link in `Web.astro`, the announcement bar's dismissal check), and pages are cached, so a nonce could not change per request anyway; `script-src` keeps `'unsafe-inline'`. The policy's value today is the inventory and the non-script directives (`object-src`, `base-uri`, `form-action`, `frame-src`, `connect-src`), not XSS prevention.

| Directive | Sources | Needed by |
| --- | --- | --- |
| `default-src` | `'self'` | Fallback |
| `script-src` | `'self' 'unsafe-inline'` | Astro's bundled and inline scripts |
| | `'wasm-unsafe-eval'` | Rive and dotLottie compile WebAssembly |
| | `https://cloud.umami.is` | Umami tracker (`Web.astro`, only when `PUBLIC_UMAMI_WEBSITE_ID` is set) |
| `style-src` | `'self' 'unsafe-inline'` | Inline `style` attributes, the draft-mode overlay, the Mux player |
| `img-src` | `'self' data: blob:` | Static assets, inline LQIP placeholders |
| | `https://cdn.sanity.io` | Sanity images |
| | `https://image.mux.com` | Mux posters, thumbnails and animated previews (`src/features/mux/utils.ts`) |
| `font-src` | `'self' data:` | Self-hosted Geist (Fontsource and `public/fonts`) |
| `media-src` | `'self' blob: https:` | Mux playback (MSE `blob:`, HLS on `*.mux.com`), Sanity video files, and editor-pasted video URLs on any https host |
| `connect-src` | `'self'` | The site's own API routes (the contact form) |
| | `https://cloud.umami.is https://gateway.umami.is` | Umami collector (Umami Cloud sends to either, depending on the account) |
| | `https://cdn.sanity.io` | Rive (`.riv`) and Lottie (`.lottie`) files |
| | `https://<projectId>.api.sanity.io https://<projectId>.apicdn.sanity.io wss://<projectId>.api.sanity.io https://api.sanity.io https://www.sanity.io` | Visual Editing and live preview in draft mode |
| | `https://stream.mux.com https://*.mux.com https://*.litix.io` | Mux HLS manifests, segments and storyboards, and Mux Data |
| | `https://unpkg.com https://cdn.jsdelivr.net` | Rive and dotLottie fetch their WebAssembly runtimes from these package CDNs by default |
| | `ws:` (dev only) | The Vite dev server's hot reload socket |
| `frame-src` | `'self'` | Nothing embeds third-party frames |
| `worker-src` | `'self' blob:` | hls.js worker inside the Mux player |
| `manifest-src` | `'self'` | A web app manifest, if a project adds one |
| `object-src` | `'none'` | No plugins |
| `base-uri` | `'self'` | No `<base>` hijacking |
| `form-action` | `'self'` | Forms post only to the site |

`<projectId>` is `PUBLIC_SANITY_PROJECT_ID`. On Vercel preview deployments (`VERCEL_ENV=preview`, read at runtime) the Vercel toolbar origins (`https://vercel.live`, `https://vercel.com`, `https://assets.vercel.com`, `wss://ws-us3.pusher.com`) are added, since Vercel injects the toolbar there.

Trimming Umami or Mux (`npm run trim`) drops their origins from `reportOnlyPolicy()` and the rows above that list them (and Umami's from the test). Rows that name Mux beside other uses (`style-src`, `media-src`, `worker-src`) stay; `media-src` still needs `https:` for Sanity video files and pasted video URLs. Rive and Lottie share `'wasm-unsafe-eval'` and the package CDNs, so once both are gone, delete those sources too.

## Adding a third-party origin

A new embed, script or API called from the browser needs its origin in the matching directive of `reportOnlyPolicy()` in `src/lib/security-headers.ts`, plus a row here. Load the affected page with DevTools open and confirm the console shows no `[Report Only]` violation. Typical project additions:

- A web font service such as Adobe Fonts (Typekit): `https://use.typekit.net` in `style-src` and `font-src`, `https://p.typekit.net` in `img-src`.
- A YouTube or Vimeo embed: `https://www.youtube-nocookie.com` or `https://player.vimeo.com` in `frame-src`.
- A third-party form or CRM script: its script host in `script-src`, its API in `connect-src`, and its submit endpoint in `form-action` if the form posts there directly.

## Moving to enforcement

1. Leave the Report-Only policy on production until the console stays clean across `/`, `/blog`, an article, a page with the contact form (including a submission), a page with each media kind you use, and a draft preview inside Presentation.
2. Self-host the Rive and dotLottie WebAssembly so `unpkg.com` and `cdn.jsdelivr.net` drop out.
3. Rename the header to `Content-Security-Policy` and merge `frame-ancestors` into it.

## Checking the headers

```bash
curl -sSI "http://localhost:<port>/" | grep -iE 'x-frame-options|content-security-policy'
curl -sSI "http://localhost:<port>/studio" | grep -iE 'x-frame-options|content-security-policy'
```

Run it against a production build and against production after a deploy: expect `X-Frame-Options`, the enforced `Content-Security-Policy` and the Report-Only one on pages, and no Report-Only header on the Studio.

## Static files

Files in `public/` and Astro's built assets under `/_astro/` are served by Vercel's filesystem layer, ahead of the function, so the middleware never sees them and they carry none of the headers above. That is fine for what `public/` holds (fonts, images, section thumbnails), which a browser never runs or frames as a page. It is not fine for a document: never put HTML, or an SVG that carries a script, in `public/`. Served from the site's own origin without `frame-ancestors` or `nosniff`, it could be framed by another site or run script as the site. Anything that renders as a page goes through a route, where the middleware adds the headers.

There is deliberately no `vercel.json` header rule for these paths: with nothing executable in `public/`, it would add a second place to keep in step with `src/lib/security-headers.ts` for no protection a passive file needs.

## Not done here

- **Cross-Origin-Opener-Policy**: not set; test it against any popup-based flow (payments, OAuth) you add before turning it on.
- **Studio policy**: the Studio needs its own allowlist (`core.sanity-cdn.com`, the Sanity API and its WebSocket, plugin hosts such as Mux) before it gets a CSP.
- **Strict-Transport-Security**: left to the host. Check the response from your production domain and add it at the host if it is missing.
