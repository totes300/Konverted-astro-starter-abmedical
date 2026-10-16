# Sanity Setup Overview

This project uses Sanity as the content backend for the website and Studio for content operations.

## High-Level Architecture

- **Dataset privacy:** Sanity's **Free** plan uses **public** datasets only; **private** datasets (token-required reads) need a **paid** plan (e.g. Growth). See [Sanity pricing](https://www.sanity.io/pricing). A new project starts private through Sanity's Growth trial and becomes public if it drops to Free; `npm run sanity:project-setup` reads the visibility back and warns (see [Project setup](./project-setup.md)), and the dataset import and migrate scripts read the target's visibility and ask before importing into one that is not private, or stop under `--yes` unless you pass `--allow-public` (see [Dataset migration](./dataset-migration.md#safety-notes)). HTTP Basic Auth (env credentials + CMS toggles) is documented in [Basic Authentication](../features/basic-auth.md); the [seed](./seed-dataset.md#the-seeded-site-starts-public) ships with protection off, so a seeded deploy is public until you turn it on.
- The Studio is **embedded by `@sanity/astro`** at the public path from `PUBLIC_SANITY_STUDIO_BASE_PATH` (default `/studio`). See [Studio Config and Structure](./studio-and-structure.md).
- Studio config lives in `sanity.config.ts`; the portable Sanity folder reads its runtime values from `sanity/config.ts`
- Schemas are defined under `sanity/schemas/` and registered in `sanity/schemas/index.ts`
- Website data is fetched through `loadQuery` in `src/sanity/lib/load-query.ts` (on top of the shared client seam in `src/sanity/lib/client.ts`)
- Draft preview and visual editing are enabled through the draft-mode endpoints and layout wiring (`src/layouts/Web.astro`)
- Rendered routes are cached with **tag-based invalidation**; a signed webhook at `src/pages/api/revalidate.ts` busts the affected tags on publish. See [Revalidation and Caching](./revalidation-and-caching.md)
- AI content generation uses Sanity Agent Actions from a Studio button. See [Agent Actions (Sanity AI generation)](./agent-actions.md)

## Core Runtime Flow

1. Content editors update data in Studio and **publish**
2. The frontend fetches data with `loadQuery` (published perspective by default, `drafts` with stega when the request carries both a verified signed preview session, `__draft_session`, and the Presentation perspective cookie)
3. The publish webhook invalidates the affected cache tags, so the next request re-renders the changed routes

## npm scripts

Sanity-related entry points use the `sanity:*` namespace in root `package.json`.

| Script                                     | Purpose                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `npm run sanity:typegen`                   | Extract schema + generate `sanity/types.ts`                                                       |
| `npm run sanity:cli`                       | Run Sanity CLI with `.env` (e.g. `npm run sanity:cli -- login`)                                   |
| `npm run sanity:dataset-export`            | Backup a dataset to `./backups/`, see [dataset migration](./dataset-migration.md)                 |
| `npm run sanity:dataset-import`            | Restore a `.tar.gz` into a dataset (see [dataset migration](./dataset-migration.md))              |
| `npm run sanity:dataset-migrate`           | Copy dataset to dataset, see [dataset migration](./dataset-migration.md)                          |
| `npm run sanity:project-setup`             | Bootstrap project, tokens, CORS, `.env` (with generated secrets), seed content, see [project setup](./project-setup.md) |

## Documentation Map

- [Studio Config and Structure](./studio-and-structure.md)
- [Schema and Content Model](./schema-and-content-model.md)
- [Fetching, GROQ, and Types](./fetching-groq-and-types.md)
- [Draft Mode and Visual Editing](./draft-mode-and-visual-editing.md)
- [Revalidation and Caching](./revalidation-and-caching.md)
- [Agent Actions (Sanity AI generation)](./agent-actions.md)
- [Dataset export, import, and migration](./dataset-migration.md)
- [Seed dataset (starter content)](./seed-dataset.md)
- [Sanity project setup](./project-setup.md)
- [Standalone Sanity folder](./standalone-folder.md)
- [Contributor Workflow](./contributor-workflow.md)
