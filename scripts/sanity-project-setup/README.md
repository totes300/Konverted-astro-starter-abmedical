# Sanity project setup (`npm run sanity:project-setup`)

**Interactive** CLI, on the same shared flow as every other script (`scripts/README.md`): prompts for org, project name or existing ID, dataset, tokens, CORS, how the dataset should start, and `.env` path, then a `📋 Summary` and one confirmation, with [ora](https://github.com/sindresorhus/ora) spinners for the steps that run.

It automates:

1. **Create a project** (`sanity projects create`) or **use an existing** project ID. A new project's dataset is requested **private** by default: the app reads with `SANITY_API_VIEW_TOKEN`, so it never needs a public dataset, and the dataset holds contact form submissions (visitors' names, emails and messages) and whatever else you add later. Current submissions use dotted ids that Sanity hides from anonymous reads, but a public dataset serves every other root-ID document to anyone, including submissions written before that change or restored from an old backup. Private datasets are a paid feature: a new project has them during Sanity's Growth trial, and a project that falls back to the Free plan afterwards has its datasets made public. Without the feature, `sanity projects create` quietly creates a public dataset, so the wizard reads the visibility back after writing `.env` (new and existing projects alike) and warns when it is not private. For an existing project that is not private, it asks again (default no) before importing the seed.
2. **API tokens**: `Frontend - View` (viewer) and `Frontend - Edit` (editor). If the run fails or you press Ctrl-C before `.env` is written, the wizard deletes the tokens it created, so none are left orphaned; errors never print the CLI's JSON output, which holds the secret.
3. **CORS**: `sanity cors add` for one or more origins (defaults to the local dev origin in `.env.example`). Public origins get credentials, which the deployed Studio needs. A local origin (`localhost`, `*.localhost`, `127.x`, `[::1]`, `0.0.0.0`, and their IPv4-mapped forms) gets its own question: the local Studio needs credentials there, but then any app served on that port can make signed-in requests to the project. It defaults to **yes** for a new project and **no** for an existing one, which may be the production project; answering no adds the origin with `--no-credentials`. A local origin with any port (`http://localhost:*`) counts as local too. An origin with a `*` anywhere (`*`, `http://localhost:*`, `https://*.example.com`) matches hosts nobody listed, so it gets a separate question that defaults to **no** for every project; prefer exact origins. An origin that already exists keeps its current setting, so answering no does not strip credentials from it; the wizard prints the delete command at the end for every local origin added with credentials or already present, and for every wildcard origin (quoted, so the shell does not expand the `*`).
4. **Generated secret**: when the `.env` has no `SANITY_REVALIDATE_SECRET`, the wizard writes a random 64-character hex value (the app refuses anything under 32). Use it when you create the publish webhook, and set it in your host. An existing value is never rotated, since a webhook may already sign with it; one under 32 characters gets a warning.
5. **Seed content**: unless you answer the content question with **Completely empty**, `sanity dataset import seed/seed-dataset.tar.gz --replace` runs against the dataset you named, so a fresh project boots with example pages, the `site` and `siteSettings` singletons, the blog, and their assets. `--replace` means re-running the wizard re-lands the full seed instead of failing on documents that already exist. For an **existing** project the question defaults to **Completely empty**, because the dataset may be the live site and the seed replaces its `site`, `siteSettings`, `homepage` and `blog`; choosing the seed there asks you to type the dataset name. The step is **skipped silently** when the checkout has no `seed/seed-dataset.tar.gz`, and it runs last, after `.env` is written; if the import fails, everything before it is already done, so retry with the `sanity:dataset-import` command the error prints rather than re-running the wizard.
6. **Starter cut**: records today as `starter.cutFrom` in `scripts/trim-features/project.json`, so `npm run trim` can later tell the starter's features from ones this project wrote. It asks first only when the checkout's `origin` is still the starter's own repository.

Writes the project's public `*_SANITY_*` keys, `SANITY_API_VIEW_TOKEN`, `SANITY_API_EDIT_TOKEN`, and `SANITY_REVALIDATE_SECRET` when it was empty. The public prefix and the CORS default are both read from `.env.example`, so the wizard writes keys this project actually reads.

The wizard registers no content webhook. The app does expose `/api/revalidate` for tag-based cache invalidation; create that webhook once by hand at sanity.io/manage with the `SANITY_REVALIDATE_SECRET` value (see docs/sanity/revalidation-and-caching.md).

Optional **HTTP Basic Auth** (`BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`) is **not** written by this script; add them in `.env` or your host if you use the feature.

If the target `.env` file does not exist but **`.env.example`** does, the script **copies** `.env.example` to that path first, then merges/upgrades the keys above (so you keep placeholders like `RESEND_*`, etc.).

## Prerequisites

- `npm run sanity:cli -- login`
- Organization id/slug from [manage](https://www.sanity.io/manage) if you create a **new** project
- First run may not have a `.env` yet: the npm script ignores `MISSING_ENV_FILE` so dotenvx does not fail; the wizard can create `.env` from `.env.example`.

## Run

```bash
npm run sanity:project-setup
```

Answer the prompts. At the end you confirm a **summary** before anything runs.

**Quick defaults (Enter):** dataset `production` · private · create tokens · add CORS for the local dev origin (with credentials on a new project) · seed content on a new project.

### Dry run

```bash
npm run sanity:project-setup -- --dry-run
```

Walks through the same questions, prints the summary, then exits without calling Sanity or writing `.env`.

## After setup

```bash
npm run sanity:typegen
```

The seed content is already in your dataset unless you asked for an empty one. To load it later, or into another dataset:

```bash
npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz
```

Seed details: `seed/README.md`.

## Security

- Never commit `.env` or tokens.
- Revoke leaked tokens in Manage → API → Tokens.
- After launch, remove the credentialed local origin: `npm run sanity:cli -- cors delete http://localhost:<port>` (the wizard prints the exact command). Add it back while you develop locally. Remove any wildcard origin too, quoting it: `npm run sanity:cli -- cors delete 'http://localhost:*'`.
- Keep the dataset private: `npm run sanity:cli -- dataset visibility set production private`.
