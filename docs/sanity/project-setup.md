# Automated Sanity project setup

Run `npm run sanity:project-setup` for an **interactive** wizard (prompts + spinners). It can provision a Sanity project (or link an existing ID) with a dataset it asks Sanity to make private, create the viewer/editor API tokens, add CORS origins, merge values into `.env` (including a generated `SANITY_REVALIDATE_SECRET`), and import the bundled [seed content](./seed-dataset.md). Use `--dry-run` to rehearse without side effects.

Details: `scripts/sanity-project-setup/README.md`.

If `.env` is missing, the wizard seeds it from **`.env.example`** (when present), then fills Sanity-related keys.

## Why a script

The [Sanity CLI](https://www.sanity.io/docs/apis-and-sdks/cli) covers projects (`sanity projects create`), tokens (`sanity tokens add`), and CORS (`sanity cors add`), but chaining them by hand for every new project is error-prone; the wizard runs them in the right order and writes a consistent `.env`.

## Alignment with this repo

- **Webhook is manual.** The wizard registers no content webhook. The app exposes `/api/revalidate` for tag-based cache invalidation; create the webhook once at [sanity.io/manage](https://www.sanity.io/manage) with projection `{_id, _type, "uri": uri.current}` and the `SANITY_REVALIDATE_SECRET` value. See [Revalidation and Caching](./revalidation-and-caching.md).
- **Env**: writes the variables the app expects (`PUBLIC_SANITY_*`, `SANITY_API_VIEW_TOKEN`, `SANITY_API_EDIT_TOKEN`). When `SANITY_REVALIDATE_SECRET` is empty it also writes a random 64-character value, which is the secret to give the webhook; an existing value is never rotated (a webhook may already sign with it), and one shorter than the 32 characters the env schema in `astro.config.mjs` requires gets a warning (env validation fails on it at startup and build). Setting it by hand, use `openssl rand -hex 32`; the webhook uses the same value.
- **Private dataset by default.** The wizard asks Sanity for a **private** dataset, then reads the visibility back. The app's server clients read with `SANITY_API_VIEW_TOKEN`, so nothing needs a public dataset, and the dataset holds contact form submissions (personal data) alongside your content. Contact submissions use dotted ids that anonymous reads never see, but a public dataset serves every root-ID document to anyone. Choose **Public** only on purpose. Private datasets are a paid feature: a new project gets them through Sanity's Growth trial, and if the project drops to the Free plan when the trial ends, Sanity turns its datasets public. Upgrade to keep it private. When the plan has no private datasets (Free, or a Growth trial already used), `sanity projects create` makes the dataset public with only a CLI warning, so the wizard reads the visibility after writing `.env`, for a new project and an existing one, and warns whenever it is not private. For an existing project that is not private it also asks again (default no) before importing the seed.
- **Tokens never leak or linger.** Error messages never include the CLI's JSON output (it carries the new token's secret), and if the run fails or is interrupted before `.env` is written, the wizard deletes the tokens it created.
- **CORS**: defaults to `http://localhost:4321` (the Astro dev server). Public origins are added with credentials, which the deployed Studio needs. A local origin gets its own question, because a credentialed `localhost` origin lets any app on that port act as a signed-in user against the project: **yes** by default for a new project (the local Studio needs it), **no** for an existing one, which may be production; **no** adds it with `--no-credentials`. A trailing `:*` port still counts as local. Any origin containing `*` (`*`, `http://localhost:*`, `https://*.vercel.app`) matches hosts you never listed, so it gets a separate credentials question that defaults to **no** for new and existing projects alike. An origin that already exists keeps its current setting, so answering no does not remove credentials from it; the wizard prints the delete command for every local origin that was added with credentials or already existed, and for every wildcard origin (quoted, so the shell leaves the `*` alone). After launch, remove it with `npm run sanity:cli -- cors delete http://localhost:4321` (a wildcard: `cors delete 'http://localhost:*'`) and add it back only while you develop.
- **Seed content**: the content question asks how the dataset should start. For a new project the default imports `seed/seed-dataset.tar.gz` with `--replace` into the dataset you named, so the site renders on the first `npm run dev` instead of showing Not Found; **Completely empty** skips it, and you can import it later with `npm run sanity:dataset-import`. For an existing project the default is **Completely empty**, since the seed replaces `site`, `siteSettings`, `homepage`, `blog` and any other same-ID document; choosing the seed there asks you to type the dataset name. See [Seed dataset](./seed-dataset.md).
- **Studio public path**: the Studio is embedded at `PUBLIC_SANITY_STUDIO_BASE_PATH` (default `/studio`). If you need a different public URL, align the env var with [Studio Config and Structure](./studio-and-structure.md).
- **Optional HTTP Basic Auth**: the wizard does **not** set `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`; add them in `.env` or your host if you use the gate. Toggles live in Sanity; see [Basic Authentication](../features/basic-auth.md).

## After setup

```bash
npm run sanity:typegen
npm run dev
```

The seed content is already in your dataset unless you asked for an empty one; `npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz` loads it later or into another dataset.
