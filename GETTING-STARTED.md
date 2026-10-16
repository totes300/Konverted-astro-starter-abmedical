# Getting started

This is the guided path from a fresh clone to your first rendered section. Follow it top to bottom. The `README.md` and the `docs/` folder are the reference; this file is the walkthrough.

## 1. Who this is for

This is a real codebase, not a no-code or drag-and-drop builder. You build the site by writing and reading code, so you should be comfortable with this stack, or ready to learn it:

- **TypeScript**, used everywhere.
- **Astro** for the front end: `.astro` components render on the server, and client behavior is written as small custom HTML elements (no React on public pages; React lives only inside the embedded Sanity Studio).
- **Tailwind CSS** for styling.
- **Sanity** for content: you define the content model as **schemas in code** and read it with **GROQ** queries.

AI agents (the `.agents/` skills, your editor's assistant) help you move faster, but they do not build the site for you, and no visual canvas edits the design. You are the engineer.

This guide does not assume you have used this exact setup before, but it does assume you can work in a terminal and a code editor and have written some TypeScript. If you have never opened an Astro project or a Sanity schema, read the docs for both first, then come back here.

## 2. Accounts you need before anything runs

- **A Sanity account.** Sign up at https://www.sanity.io/. This is where your content lives.
- **A Sanity organization.** The setup wizard in step 4 asks for an organization id or slug, and the Sanity CLI cannot create one for you. Create it once in the dashboard at https://www.sanity.io/manage (your account may already have a default organization there; either is fine). Keep its id or slug handy for step 4.
- **A GitHub account**, for repository access.
- **Node 24.15.0**, the version pinned in `.nvmrc` and in `package.json` (`engines`, `volta`). If you use a Node version manager (nvm, fnm, asdf, Volta), switch to that version inside the project folder. `engines` requires the `^24.15.0` LTS line, so `npm install` fails fast on any other major rather than breaking somewhere deep in the dependency tree. npm 11.6.2 or newer (it ships with recent Node).

## 3. Clone and install

```bash
git clone <your-repo-url>
cd konverted-webos-starter
nvm use        # optional: matches .nvmrc (Node 24.15.0)
npm install
```

## 4. Run the setup wizard

This is the recommended path. First authenticate the Sanity CLI once (the wizard needs it):

```bash
npm run sanity:cli -- login
```

Then run the wizard and answer its prompts:

```bash
npm run sanity:project-setup
```

In one pass it provisions a Sanity project, two API tokens (read and write), CORS origins, your `.env` file (with a generated `SANITY_REVALIDATE_SECRET`), and the bundled example content, so you do not have to assemble any of that by hand. Three prompts are worth knowing in advance:

- **Organization:** paste the id or slug from step 2. The wizard creates the project inside it.
- **Dataset visibility:** keep the default, **Private**. The site reads with its own token, and the dataset will hold contact form submissions. Private datasets are a paid Sanity feature that a new project's Growth trial includes; on a plan without them Sanity creates the dataset public, and the wizard warns you after writing `.env`.
- **How the dataset should start:** keep the default, **with the bundled example content**, unless you specifically want a blank Studio. The wizard imports the seed for you at the end of the run.

After it finishes, open `.env` and confirm `PUBLIC_SITE_URL=http://localhost:4321` is set (copy any missing lines from `.env.example`), then generate the Sanity types for your project:

```bash
npm run sanity:typegen
```

> **Fallback, only if the wizard does not fit your setup.** Create `.env` by hand: copy `.env.example` to `.env` and fill the Sanity values yourself (project id, dataset, tokens). Prefer the wizard: it fills these correctly and avoids the placeholder-credentials dead end where the app boots but nothing renders.

## 5. Check the seed content

If you kept the default answer in step 4, your dataset already holds the bundled example content: example pages, the `site` and `siteSettings` singletons, the blog, and the images they use. That is what makes the next step show a real site instead of an empty one.

Chose **Completely empty**, or want to reload the seed later? Import it any time:

```bash
npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz
```

The import reads the dataset's visibility first and asks before writing into one that is not private.

Details: [`docs/sanity/seed-dataset.md`](docs/sanity/seed-dataset.md).

## 6. Run it and see it

```bash
npm run dev
```

- **Site:** http://localhost:4321
- **Studio:** http://localhost:4321/studio

You should see a populated home page on the site, and a Studio at `/studio` listing the example pages and the site settings. If the site shows a Not Found page or the Studio is empty, jump to [Troubleshooting](#9-troubleshooting).

## 7. The mental model, once

This is the one idea to hold on to:

- **Sanity is built from schemas, and schemas are defined in code** (in `sanity/schemas/`).
- **You fill those schemas with content in the Studio** (the `/studio` URL).
- **The front-end code fetches that content and renders it.**

Schema in code, content in Studio, render in code. Nothing edits the live design from a canvas: you change behavior in code, and content in the Studio.

## 8. Build your first section

Scaffold a page builder section with the generator. Do not hand-create these files; the generator wires them up for you:

```bash
npm run plop
```

Choose **Page Builder Section** and give it a name, for example `hero`. The generator suffixes it to `heroSection` and:

- creates the schema at `sanity/schemas/page-sections/hero-section.tsx`,
- creates the component at `src/features/page-builder/sections/HeroSection.astro`,
- adds its GROQ query to `src/features/page-builder/queries.ts`,
- registers it in `sanity/schemas/page-sections/index.ts` and `src/features/page-builder/PageSections.astro`,
- runs `npm run sanity:typegen` and formatting for you.

That is the code side. Now the content side:

1. Open the Studio at http://localhost:4321/studio.
2. Open the home page document and find its **Page Builder** field.
3. Add your new section to it, set the **Title**, and **Publish**.
4. Refresh http://localhost:4321. If it does not appear, stop and restart `npm run dev`.

You will see your section render as a tall red placeholder block showing its content. That block is the generated starting point; you replace its markup in `src/features/page-builder/sections/HeroSection.astro`. You just closed the loop: a schema you defined in code, filled in the Studio, rendered by the front end. More on the generators: [`docs/features/code-generation.md`](docs/features/code-generation.md).

## 9. Troubleshooting

- **The site shows Not Found, or nothing renders.** Your dataset has no home page yet, or `PUBLIC_SANITY_PROJECT_ID` in `.env` points at the wrong or empty project. The home route looks for a page whose URL is `/`, and the seed includes one. Run the import in step 5, and confirm the project id in `.env` matches the project you set up.
- **The Studio at `/studio` will not load, or is empty.** Almost always a missing or mismatched `PUBLIC_SANITY_PROJECT_ID`. Re-run `npm run sanity:project-setup`, or fix the value by hand, then restart `npm run dev`.
- **`npm run dev` or `npm run build` fails with an environment error.** A required variable is missing from `.env`, or `SANITY_REVALIDATE_SECRET` is set but shorter than 32 characters (generate one with `openssl rand -hex 32`, or leave it empty). Compare your `.env` against `.env.example`; the schema lives in `astro.config.mjs`.

## 10. Before you launch

- [ ] **Rate limit the contact form endpoint.** Every accepted contact form submission writes to Sanity and sends email, and nothing in the code limits how often. Add a Vercel Firewall rule: method `POST` and path ends with `contact-form`, 30 requests per 600 seconds per IP, respond `429`. Not "equals": dot segments and backslashes are resolved before the endpoint sees the path, so `/api/x/../contact-form` would slip past an exact match. Details: [`docs/features/spam-prevention.md#rate-limiting`](docs/features/spam-prevention.md#rate-limiting).
- [ ] **Rate limit the preview endpoint.** Each request to `/api/draft-mode/enable` with a well-formed preview secret spends one Sanity API query, and the route needs no credentials to call. Add a second rule: path contains `draft-mode` and ends with `enable`, 30 requests per 60 seconds per IP, respond `429`. Not "starts with": the endpoint refuses every spelling that does not resolve to its exact path, but dot segments and backslashes can be resolved before routing, so `/api/./draft-mode/enable` or `/api/draft-mode/./enable` reaches it as the exact path. Never give `/api/revalidate` or `/api/cache-purge` a rate limit of their own. Details: [`docs/sanity/draft-mode-and-visual-editing.md#rate-limit-the-handshake`](docs/sanity/draft-mode-and-visual-editing.md#rate-limit-the-handshake).
- [ ] **Add the rest of the firewall baseline.** Three more rules: Studio-backed routes (header `authorization` starts with `Bearer`), Basic Auth attempts (header `authorization` exists and does not start with `Bearer`), and all requests (600 per 60 seconds per IP). Size each from real use. Conditions and limits: the Vercel baseline in [`.agents/skills/security-audit/SKILL.md`](.agents/skills/security-audit/SKILL.md) (section 12), and [`docs/features/studio-api-auth.md#rate-limit`](docs/features/studio-api-auth.md#rate-limit).
- [ ] **Check the webhook secret's length.** `SANITY_REVALIDATE_SECRET`, when set, must be at least 32 characters, or the build and `astro dev` fail with `EnvInvalidVariables`. A site first deployed with a shorter one: generate a new one with `openssl rand -hex 32` and set it in the Vercel env (all environments), your local `.env` and the Sanity webhook's **Secret** field, then deploy. Unsetting it also builds, with webhook revalidation off. Details: [`docs/deployment.md#environment-variables`](docs/deployment.md#environment-variables).

## 11. Where to go next

- Documentation hub: [`docs/README.md`](docs/README.md)
- Sanity setup overview: [`docs/sanity/README.md`](docs/sanity/README.md)
- Deployment: [`docs/deployment.md`](docs/deployment.md)
- Seed dataset: [`docs/sanity/seed-dataset.md`](docs/sanity/seed-dataset.md)
- Code generation (Plop): [`docs/features/code-generation.md`](docs/features/code-generation.md)
- Optional HTTP Basic Auth for staging gates: [`docs/features/basic-auth.md`](docs/features/basic-auth.md)
- Working with AI agents in this repo: [`AGENTS.md`](AGENTS.md)
