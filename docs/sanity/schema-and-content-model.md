# Schema and Content Model

## Schema Source of Truth

- Schema registration: `sanity/schemas/index.ts`
- Registered documents:
  - `site`
  - `siteSettings`
  - `redirect`
  - `page`
  - `legalPage`
  - `contactFormSubmission`
  - `imageAltText` (scratch type for the alt-text Agent Action, in `AGENT_SCRATCH_DOCUMENTS`; see [Automatic alt text](../features/auto-alt-text.md))
  - `blog` (the `/blog` index singleton)
  - `article`
  - `articleCategory`
  - `person`
- Registered global field/object types:
  - `aspectRatio`
  - `videoOptions`
  - `riveOptions`
  - `lottieOptions`
  - `appColor`
- Page section schemas come from `sanity/schemas/page-sections/index.ts`
- After schema changes, run `npm run sanity:typegen` (see [Contributor Workflow](./contributor-workflow.md))

## Core Document Contracts

### `page`

Defined in `sanity/schemas/documents/page.tsx`:

- `title` (required)
- `uri` from `createUriField` (required)
- `passwordProtected` (boolean): when site-wide Basic Auth is off, gates this URL (credentials in env; see [Basic Authentication](../features/basic-auth.md))
- `pageBuilder` from `createPageBuilderField` (required)
- `seoMetadata` from `createSeoField` (`sanity/schemas/fields/create-seo-field.tsx`): on the homepage only **No Index** shows; the marketing fields (title, description, share image) are hidden because the homepage inherits SEO defaults from the Site singleton. **No Index** keeps a page out of search engines, the sitemap, the RSS feed, `llms.txt` and agent Markdown, and an article also out of the blog index, its author's page and the category filter; the page itself stays reachable at its URL. The share image's **Source URL** must be an `https` page on the site's own apex or `www` host: the screenshot route (`/api/seo-screenshot`, checks in `src/features/api/screenshot-checks.ts`) refuses anything else, and accepts back only a JPEG or PNG of at most 10 MB from Microlink's asset host
- `agentMarkdown` from `createAgentMarkdownField` (`sanity/schemas/fields/create-agent-markdown-field.tsx`, Agents group): `enabled` (serve toggle) + `content`, the per-page Markdown served to AI agents. Generate it from the page's content with one click, then publish. See [Agent Markdown](../features/agent-markdown.md)

Groups:

- `page`
- `content`
- `seo`
- `agents`

### `blog` (singleton)

Defined in `sanity/schemas/documents/blog.tsx`. The index of the `/blog` prefix route: the page that lists the articles, served by its own route rather than by the `[...uri]` catch-all, which only handles `page` and `legalPage` documents:

- `title` (required): navigation and breadcrumb label
- `uri` from `createUriField`, **read only** and prefilled with `SANITY_BLOG_INDEX_URI` (`/blog`) via `initialPath`. It exists so every routed document is treated the same way by the sitemap, llms.txt, and agent Markdown, all of which select on `defined(uri.current)` without naming types
- `showHeader`, `showFooter`: same meaning as on `page`
- `passwordProtected`: gates `/blog` alone. Each article keeps its own switch, and author pages and the RSS feed follow only **Protect entire site**
- `heading` (required) + `intro` rich text (Content group): the H1 and the copy above the listing
- `seoMetadata`, `agentMarkdown`: identical to `page`

**No page builder.** The index is always the heading, the intro, and the article list, so there are no sections to assemble. The listing is not authored either: the route reads every `article` that is neither `noIndex` nor password protected, newest first (`BlogArticleListQ` in `src/features/blog/queries.ts`, the sitemap's visibility rule), and no page-builder section can produce it. A category gets a chip only when one of those visible articles is filed under it, and the URL's `?category=` slugs are validated, deduped and capped at ten before they reach the query or the cache key (`src/features/blog/category-filter.ts`). Articles slug under the same constant (`/blog/{slug}`), and `createUriField` rejects `/blog` on any other document so nothing can shadow the index route.

### `site` (singleton)

Defined in `sanity/schemas/documents/site.tsx`. The copy that renders on every page:

- `name` (required)
- `notFound` (object): the 404 copy, its link, and the `showHeader` / `showFooter` toggles
- `header.links` (required array of `appLink`)
- `contacts` (array of contact objects with `name` + `appLink`)
- `footer.links` (required)
- `footer.legalLinks`
- `seoMetadata` (site-wide SEO defaults from `createSeoField`): serving Markdown to agents is decided per page (the `agentMarkdown` object on every routed document: `page`, `legalPage`, `article`, `person`, `blog`), so the singleton has no such toggle; its own AI surface is `siteSettings.llms`

### `siteSettings` (singleton)

Defined in `sanity/schemas/documents/site-settings.tsx`, listed in the Studio as **Settings**. The configuration behind how the site is served, kept apart from `site` so the document editors open holds only copy they write:

- `redirects` array of `redirect` items (General group), with duplicate `from` validation
- `favicon` (object, General group): `iconLight` / `iconDark` tab icons; URLs built in `src/features/site/seo/favicon.ts` and declared by `src/layouts/Web.astro`. The head also declares `/favicon.ico` first and unconditional (`src/pages/favicon.ico.ts`), which serves whichever variant is filled in: Google Search takes one favicon per hostname and ignores `media`, so it must not be left to choose between the two scheme-qualified links
- `basicAuth` (object, Security group): toggles only (`siteWideEnabled`); HTTP Basic Auth credentials live in deployment env, not the CMS. See [Basic Authentication](../features/basic-auth.md)
- `llms` (object, Agents group): `enabled` (serve toggle), `guidance` (AI steer), and `content` (Markdown served at `/llms.txt`). The Agents group holds one object per AI surface (more can be added beside `llms`). The field has a Generate button powered by [Agent Actions](./agent-actions.md). See [llms.txt and AI agents](../features/llms-txt.md)
- `agentMarkdown` (string, Agents group): holds no value; it hosts the panel that backfills the per-page agent Markdown on every page still missing it (`AgentMarkdownBackfillInput`). See [Agent Markdown](../features/agent-markdown.md#backfill)
- `altText` (object, Agents group): `enabled` (describe new uploads) and `guidance` (AI steer) for automatic image alt text, plus the backfill panel (`AltTextInput`). Descriptions are written to `sanity.imageAsset.altText`, not to the singleton. See [Automatic alt text](../features/auto-alt-text.md)
- `contactFormNotificationEmails` (array of emails, Email Notifications group). See [Contact form notifications](../features/contact-form-notifications.md)

A field belongs here when it configures how the site is served, and on `site` when it is content that renders.

### `redirect`

Used inside `siteSettings.redirects` and consumed by Astro's `redirects` config in `astro.config.mjs`, which reads the settings by `_id` and drops any entry outside the plain same-site subset the build accepts; the **From** and **To** fields refuse the same entries (see [Redirects](../features/redirects.md#what-the-build-accepts)).

### `legalPage`

Defined in `sanity/schemas/documents/legal-page.tsx`. A policy document (privacy policy, terms of service, cookie policy). Served by the same `[...uri]` catch-all as `page` and resolved by URI alone, so nothing about the route is special: the difference is the shape of the document.

- `title` (required), `uri`, `passwordProtected`, `showHeader` / `showFooter`, `seoMetadata`, `agentMarkdown`, exactly as on `page`
- `content`: one required rich text field (`variant: "full"`) instead of a page builder. A legal page is prose, so there is nothing to assemble
- New pages auto-slug under `SANITY_LEGAL_PATH_PREFIX` (`/legal/{slug}`), and the URI stays editable afterwards

### Other documents

- `article`: prose, not an assembled page. The body is a single `content` rich text field (no page builder), and reading time is derived from it at render rather than stored. `author` is a reference to a `person`, not a string, so a byline is one document every article shares. Includes `passwordProtected` (same env-based Basic Auth as `page`; see [Basic Authentication](../features/basic-auth.md))
- `articleCategory`: a unique `name` and a `slug`, the value the blog index filter carries in its URL (`/blog?category=engineering`). The slug is lowercase letters, digits and hyphens, at most 64 characters
- `person`: an article's byline, and a routed document in its own right. `name`, `role`, a portrait, a `bio` rich text field, and `links` (`appLink` array, published as the Person's `sameAs` in structured data). Auto-slugs under `SANITY_AUTHOR_PATH_PREFIX` (`/blog/authors/{slug}`); the page is served by its own prefix route, and an article's byline opens the same profile as a panel (see [Dialogs and overlay routes](../features/dialogs-and-overlay-routes.md))
- `contactFormSubmission` (API-only content, written by `/api/contact-form` under a dotted id from `apiOnlyDocumentId()` in `sanity/constants.ts`, which anonymous reads never see; see [Contact Form Notifications](../features/contact-form-notifications.md#where-submissions-live))

## Field Factories and Reusable Types

Field factories are under `sanity/schemas/fields/`:

- `createLinkField` -> `appLink`. A **URL Params** link is stored as a raw string, so it must start with `/`, `?` or `#`, with no whitespace, control character, backslash or leading `//` (`relativeHrefProblem` in `sanity/schemas/fields/relative-href.ts`). Whatever the link type, the link fragment drops an href outside site-relative, `http`, `https`, `mailto` and `tel`, and the renderers check again with `safeHref` (`src/features/sanity/link/safe-href.ts`) wherever a CMS value reaches an `href` or JSON-LD
- `createMediaField` -> `appMedia` (image, Mux video, video file, video URL, Rive, or Lottie; see [Motion media in appMedia](#motion-media-in-appmedia))
- `createRichTextField` -> `appRichText`
- `createPageBuilderField`
- `createUriField`

Reusable shared objects:

- `seoMetadata`
- `aspectRatio`
- `videoOptions`
- `riveOptions` (loop, autoPlay; used when media type is Rive)
- `lottieOptions` (loop, autoPlay; used when media type is Lottie)
- `appColor`: a brand palette token name (`BRAND_COLORS` in `sanity/colors.ts`), picked from named swatches. The renderer resolves only a palette name to its CSS variable, or a strict hex stored by older content to itself (`tokenColor` in `src/sanity/rich-text/components/token-color.ts`); anything else, which only an API write could store, renders uncoloured. The Studio refuses any other value and warns on a raw hex

Helper utilities:

- `visibleIf`, `requiredIf`, `uniqueReferenceArray`, `createExcerptFromPortableText`, and `selectByName` (shared `whitelist`/`blacklist` filtering used by the field factories) in `sanity/utils.ts`

### Motion media in appMedia

`createMediaField` in `sanity/schemas/fields/create-media.tsx` is a single object with a **media type** radio: **image**, **Mux video** (`mux.video`), **video file** (self-hosted upload), **video URL** (a plain external link such as an `.mp4`), **Rive**, or **Lottie**. Pass `whitelist` or `blacklist` (arrays of type values such as `videoMux` or `videoUrl`) to restrict which options editors can pick; the two are mutually exclusive (passing both throws).

For **Video file** and **Video URL** (native HTML5 `<video>`, no Mux):

- **`videoFile`** (Sanity `file`, accepts `video/*`). The file ships inside the dataset export.
- **`videoUrl`** (a direct link to an `.mp4`/`.webm`, validated as an `http(s)` URL). Nothing is added to the dataset export; the asset stays where it is hosted. That validation is Studio only, so the player takes the source through `safeVideoSrc()` (`src/features/sanity/media/utils.ts`, the `safeHref()` allowlist) and renders nothing for a `data:`, `javascript:` or `//host` value, or a value that is not a string, that an API write stored.
- Both require a **`videoCover`** image, the poster, whose dimensions stand in for the video's. They share **`videoOptions`** (controls, loop, muted, autoPlay) and render through **`SanityNativeVideo`** (`src/sanity/media/SanityNativeVideo.astro`); the GROQ fragment resolves each into `{ url, dimensions }`, the dimensions read from the cover.

For **Rive**:

- **`riveFile`**: Sanity `file` field; accepts `.riv`. **Generate** in `sanity/inputs/rive-file-input.tsx` reads dimensions from the Rive default artboard (`sanity/lib/parse-rive-dimensions.ts`). Dimensions are cleared when the asset changes.
- **`riveOptions`**: object type from `sanity/schemas/fields/rive-options.tsx` (`loop`, `autoPlay`), registered in `sanity/schemas/index.ts`.
- **`riveDimensions`**: required when media type is Rive; validation requires positive `width` and `height`.

For **Lottie**:

- **`lottieFile`**: Sanity `file` field; accepts Bodymovin JSON (`.json`) and dotLottie (`.lottie`). **Generate** in `sanity/inputs/lottie-file-input.tsx` only auto-fills **`lottieDimensions`** from **Bodymovin JSON** bytes (`sanity/lib/parse-lottie-dimensions.ts`); for `.lottie`, set dimensions manually or use a `.json` export. Dimensions are cleared when the asset changes.
- **`lottieOptions`**: object type from `sanity/schemas/fields/lottie-options.tsx` (`loop`, `autoPlay`), registered in `sanity/schemas/index.ts`.
- **`lottieDimensions`**: required when media type is Lottie; validation requires positive `width` and `height`.
- **`aspectRatio`**: when `withCustomRatio` is enabled on the field, editors can override the ratio used in the frontend; the GROQ fragment prefers an explicit `aspectRatio` above 0, then Lottie dimensions, then defaults. Before a ratio reaches a `style`, the renderers clamp it between 1:20 and 20:1 (`cssAspectRatio` in `src/features/sanity/media/utils.ts`), and an image's blur placeholder is used only when it is a base64 image data URI (`safeLqip`).

**Runtime:** `src/sanity/media/SanityMedia.astro` branches on `type` and renders the matching `.astro` component: `SanityImage`, `SanityMuxVideo` (`<mux-player>`), `SanityNativeVideo`, `SanityLottie` (the `<dotlottie-wc>` web component), or `SanityRive` (a `rive-canvas` custom element wrapping `@rive-app/canvas`, `src/sanity/media/RiveElement.ts`). Loop/autoplay follow the CMS options; the Lottie and Rive elements are lazily hydrated via `lazyCustomElement` so their runtimes stay out of the initial bundle. Both video renderers wrap their player in `VideoPlayer.astro` (the `video-player` element, `src/sanity/media/VideoPlayerElement.ts`), which owns playback for native and Mux alike: an autoplaying video plays only while it is on screen, the tab is shown and reduced motion is off, and starts muted. A video without controls toggles on a click, and keyboard and assistive tech reach the same toggle as a visually hidden button whose focus ring is drawn on the video. With no JS an autoplaying video rests on its poster.

**Queries:** reuse **`MediaFragment`** from `src/features/sanity/media/fragment.ts` wherever `appMedia` is projected so `type`, Rive/Lottie URLs, dimensions, and options stay in sync with the UI.

## URI Rules

URI behavior is defined in `sanity/schemas/fields/create-uri-field.tsx`:

- Slugs are kebab-cased
- Non-homepage pages become `/{slug}`
- Homepage singleton URI is forced to `/`
- `/blog` is reserved for the blog index singleton; articles slug under it as `/blog/{slug}`
- People default to `/blog/authors/{slug}`, under the blog so one prefix covers an article and the author panels it opens over itself
- Legal pages default to `/legal/{slug}`, a prefill rather than a reservation: the catch-all serves whatever URI the document ends up with
- `drafts.` prefix is stripped before singleton checks
- Addresses another route answers first are refused (`reservedRouteIssue` and `blogRouteIssue`): anything under the Studio path, `/404`, anything under `/section-preview`, and `/blog/<slug>`, `/blog/authors/<slug>` or the author panel's `/blog/authors/<slug>/modal` for a page or legal page; a deeper path such as `/blog/authors/jane/cv` is the catch-all's. An article must be `/blog/<slug>` and a person `/blog/authors/<slug>`, the only addresses their routes serve. Prefixes count by whole segment (`/studios` passes)
- URIs the Basic Auth gate cannot check as a page are flagged: whitespace, a control character, a backslash, `%`, a colon, a dot, a path under `/api` or any `/_` prefix, and `/index` (`uriGateProblem` in `sanity/schemas/fields/uri-gate.ts`). A warning, and an error once **Password protect** is on; see [URIs the gate cannot cover](../features/basic-auth.md#uris-the-gate-cannot-cover)

## Page Builder Data Shape

`createPageBuilderField` wraps each section item into:

- `sectionSettings`
  - `sectionTitle`
  - `sectionHash` (slug, unique per page)
- `sectionContent`
  - actual section schema payload

Section wrappers are named `{sectionName}Field`, for example `mediaSectionField`.

This wrapper shape is what frontend rendering expects in `src/features/page-builder/PageSections.astro`, and what the per-section queries in `src/features/page-builder/queries.ts` match on (`_type == "{sectionName}Field"`).
