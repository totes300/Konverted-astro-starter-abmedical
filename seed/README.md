# Seed dataset

Starter content that ships with the template so a freshly cloned project boots with example data instead of an empty Studio.

`seed-dataset.tar.gz` is a standard Sanity dataset export containing:

- example **pages**
- the **`site`** singleton (header, footer, SEO defaults) and the **`siteSettings`** singleton (site-wide configuration)
- the **`blog`** index singleton plus its example **articles**, **article categories**, and the **`person`** they are bylined to
- the **image and file assets** they reference (about 5 MB total)

The seeded site starts public: `siteSettings` ships with **Protect entire site** off and no page is password-protected, so a fresh project boots without any credentials. Turn protection on in **Settings** → **Security** → **HTTP Basic Auth** when you need it; see [Basic Authentication](../docs/features/basic-auth.md).

## Import it (seed your dataset)

[`npm run sanity:project-setup`](../docs/sanity/project-setup.md) already does this: its last question asks how the dataset should start, and the default answer imports this archive with `--replace`.

To import it separately (you answered **Completely empty**, or you are seeding another dataset), with the CLI authenticated (`npm run sanity:cli -- login`):

```bash
npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz
```

Or run `npm run sanity:dataset-import` with no flags and pick the seed from the list. It then asks which dataset to import into, with the `.env` one offered first; pass `--dataset <name>` to answer that up front, or `--replace` to overwrite existing documents.

## Refresh it (template authors)

To regenerate this archive from your own content:

```bash
npm run sanity:cli -- dataset export production seed/seed-dataset.tar.gz \
  --types page,legalPage,site,siteSettings,blog,article,articleCategory,person,sanity.imageAsset,sanity.fileAsset --overwrite
```

To edit the export by hand (say, one setting in `data.ndjson`) and pack it again on macOS, keep the system's metadata out of the archive: `COPYFILE_DISABLE=1` stops `tar` adding an AppleDouble `._` file per entry, and `--no-xattrs` drops the extended attributes (`com.apple.provenance` and the like):

```bash
COPYFILE_DISABLE=1 tar --no-xattrs -czf seed/seed-dataset.tar.gz production-export-<timestamp>
```

`scripts/sanity-dataset/seed.test.ts` (`npm test`) fails on either kind of metadata.

**Security note:** a full dataset export includes **every** document, secrets and personal data included. In this project that means the Mux config document (`mux.apiKey`), which stores a private signing key and access token, the preview URL secrets, and contact form submissions. The `--types` allowlist above is what keeps them out of the committed seed: it exports only content types (pages, the `site` and `siteSettings` singletons, and image/file assets). Keep that list and extend it when you add new content types. `npm test` checks that every reference in the archive resolves, so a referenced type missing from the list fails there instead of at import. `scripts/sanity-dataset/seed.test.ts` (also `npm test`) fails on any type outside the allowlist and on any secret-bearing or dotted-id document (`sanity.previewUrl*`, `sanity.secrets`, `mux.*`, `secrets.*`, `contactFormSubmission`, `drafts.`, `versions.`). It keeps its own copy of the allowlist (`SEED_TYPE_ALLOWLIST`), so extend it together with `--types`. The same caution applies to full backups from `npm run sanity:dataset-export`: treat those archives as sensitive and never commit or share them.

Full reference: [`docs/sanity/seed-dataset.md`](../docs/sanity/seed-dataset.md).
