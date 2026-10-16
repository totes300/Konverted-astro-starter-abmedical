# Dataset CLI (`scripts/sanity-dataset/`)

Sanity dataset **export** (backup), **import** (restore or seed), and **migration** (copy between datasets). All three are interactive: run them with no flags and they ask, summarise, then confirm (see the shared flow in `../README.md`). Shared logic lives in `lib.ts`.

| File                 | Role                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `export.ts`          | Backup one dataset → `./backups/<dataset>-YYYY-MM-DD-HHMMSS.tar.gz`          |
| `import.ts`          | Import a local `.tar.gz` into a dataset (interactive picker, or `--file`)    |
| `migrate.ts`         | Export one dataset, then import it into another (standard, replace, clean)   |
| `dataset-picker.ts`  | The shared "which dataset?" prompt, backed by `sanity dataset list`          |
| `lib.ts`             | Env parsing, CLI arg builders, validation, dataset-list parsing (no I/O)     |
| `lib.test.ts`        | Unit tests for the pure `lib.ts` helpers (`npm test`)                        |
| `seed.test.ts`       | Checks the committed seed: references, bundled assets, type allowlist, no secrets |

Backup filenames include a `YYYY-MM-DD-HHMMSS` timestamp so repeated runs on the same day never overwrite a prior archive.

Entrypoints are still the root `package.json` scripts (`npm run sanity:dataset-export`, `npm run sanity:dataset-import`, `npm run sanity:dataset-migrate`).

## Dataset export

With no flags it asks which dataset to export (picker) and whether to include assets, then confirms.

```bash
npm run sanity:dataset-export
npm run sanity:dataset-export -- --dataset staging
npm run sanity:dataset-export -- --dataset staging --no-assets --yes
```

| Flag               | Description                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `--dataset <name>` | Dataset to export (defaults to the interactive picker, or the `.env` dataset with `--yes`)  |
| `--no-assets`      | Documents only (faster, smaller)                                                            |
| `--dry-run`        | Print the plan and exit                                                                     |
| `--yes`            | Skip all prompts                                                                            |

## Dataset import

Interactive restore (the counterpart to export). With no flags it prompts for the archive (a picker over the seed and `./backups`), the target dataset, replace mode, and a final confirmation.

```bash
npm run sanity:dataset-import
npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz
npm run sanity:dataset-import -- --dataset staging --replace
```

| Flag               | Description                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `--dataset <name>` | Target dataset (defaults to the interactive picker, or the `.env` dataset with `--yes`; required with `--replace --yes`) |
| `--file <path>`    | Archive to import (defaults to the interactive picker)                                             |
| `--replace`        | Overwrite documents with the same IDs                                                              |
| `--allow-live-target <name>` | Allow `--replace` on the `.env` dataset; repeat its name                                 |
| `--allow-public`   | Allow a target whose visibility is public, custom, or cannot be read                               |
| `--dry-run`        | Print the plan and exit (requires `--file`)                                                        |
| `--yes`            | Skip all prompts (requires `--file`)                                                               |

Three refusals protect the live site:

- `--replace --yes` without `--dataset` stops: an unattended overwrite has to name its target, so it never lands on the `.env` dataset by default. A `--dry-run` only warns and prints the plan.
- `--replace` into the dataset named in `.env` (the live site) needs `--allow-live-target <that name>` in a `--yes` run, which otherwise stops and prints the project. Interactively you type the name instead, after the final confirmation; `--dry-run` only warns. A standard import needs neither, since it fails on existing IDs rather than overwriting them. This is the same rule as migrate's.
- The target should be **private**. The script reads its visibility (`sanity dataset visibility get`); for a public or custom dataset, or one it cannot read, an interactive run asks before importing and a `--yes` run stops unless you pass `--allow-public`. Private datasets need a paid Sanity plan (a new project's Growth trial included), so on the Free plan answer yes or pass `--allow-public`. A backup holds every document, contact form submissions included, and a public dataset serves every root-ID document in it to anyone without a token.

## Dataset migration

With no flags it asks for the source, the target, and how the import should treat the target, then confirms once before anything runs.

```bash
npm run sanity:dataset-migrate
npm run sanity:dataset-migrate -- --from <source> --to <target>
```

| Flag               | Description                                                         |
| ------------------ | ------------------------------------------------------------------- |
| `--from <dataset>` | Source dataset (defaults to the interactive picker)                 |
| `--to <dataset>`   | Target dataset (defaults to the interactive picker)                 |
| `--replace`        | Overwrite documents with the same IDs                               |
| `--clean`          | Back up the target, delete it, recreate it (private when the plan allows), and import |
| `--skip-cleanup`   | Keep the source `.tar.gz` after import                              |
| `--allow-live-target <name>` | Allow `--clean` or `--replace` on the `.env` dataset; repeat its name |
| `--allow-public`   | Allow a target that is public, custom, or of unreadable visibility (with `--clean`, one that may be recreated public) |
| `--dry-run`        | Print the plan and exit (requires `--from` and `--to`)              |
| `--yes`            | Skip all prompts (requires `--from` and `--to`)                     |

`--replace` and `--clean` are mutually exclusive. Passing neither leaves the mode to the prompt, which offers standard, replace, and clean.

`--clean` exports the target to `./backups/<to>-pre-clean-<timestamp>.tar.gz` before deleting it. If that snapshot fails (for example the target does not exist yet), an interactive run asks you to confirm before continuing, and a `--yes` run stops without deleting anything. The snapshot is preserved even when the source export is cleaned up.

`--clean` or `--replace` into the dataset named in `.env` (the live site) needs `--allow-live-target <that name>` in a `--yes` run; interactively you type the name instead. `--dry-run` only warns, as it does for import's missing `--dataset`. A standard import (no replace) needs neither, since it fails on existing IDs rather than overwriting them. The target's visibility is checked as for import; in clean mode the check runs before the backup and delete (neither the target nor the source reading as private means the plan may have no private datasets, since Sanity then creates the target public), and the recreated target is read back again before importing.

### Examples

```bash
npm run sanity:dataset-migrate -- --from production --to staging --clean
npm run sanity:dataset-migrate -- --from production --to staging --replace
npm run sanity:dataset-migrate -- --from production --to staging --skip-cleanup
```

## Seed dataset

Bundled starter content lives in `seed/seed-dataset.tar.gz` and ships with the template. There is no dedicated script; use the raw `sanity:cli` wrapper:

```bash
# seed a project (or run `npm run sanity:dataset-import` and pick the seed)
npm run sanity:dataset-import -- --file seed/seed-dataset.tar.gz

# refresh the seed from your content (the --types allowlist keeps secrets out)
npm run sanity:cli -- dataset export production seed/seed-dataset.tar.gz \
  --types page,legalPage,site,siteSettings,blog,article,articleCategory,person,sanity.imageAsset,sanity.fileAsset --overwrite
```

A full export bundles **every** document, including secret-bearing ones such as the Mux `mux.apiKey` doc (private signing key + token), preview URL secrets and contact form submissions; the `--types` allowlist is what keeps them out of the committed seed. `seed.test.ts` (`npm test`) fails when the archive holds a type outside that allowlist, any `sanity.previewUrl*`, `mux.*`, `secrets.*` or `contactFormSubmission` document, a dotted id (`drafts.`, `versions.` or any other non-root document), a second copy of a singleton, or a key named like a token or password with a value.

## Requirements

- `.env` with project and dataset: either `SANITY_PROJECT_ID` / `SANITY_DATASET` **or** the app's own public pair, whatever prefix its framework gives them.
- Authenticated Sanity CLI: `npm run sanity:cli -- login`. The dataset pickers list the project's datasets through it; without a session they fall back to typing the name.
- Permissions to export/import datasets for the project (dataset create/delete for `--clean`).
