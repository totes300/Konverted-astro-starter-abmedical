# Dataset export, import, and migration

Use these workflows to back up a dataset, restore an archive into one, or copy content between Sanity datasets (for example production to staging).

## Commands

| Script                           | Purpose                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run sanity:dataset-export`  | One-off backup of a dataset to `./backups/`                                                 |
| `npm run sanity:dataset-import`  | Restore a `.tar.gz` into a dataset (pick from `./backups`/seed, or `--file`)                |
| `npm run sanity:dataset-migrate` | Export one dataset, then import it into another (standard, replace, or clean)               |

All three are interactive: run them with no flags and they ask what they need (datasets come from a picker over the project's real datasets), print a `📋 Summary`, then ask for one confirmation. Flags answer those questions up front; `--dry-run` prints the plan and stops, `--yes` skips every prompt. The shared flow is described in `scripts/README.md`.

Full flag reference: `scripts/sanity-dataset/README.md` (or the scripts' `--help`).

For the bundled starter dataset that ships with the template (to seed a fresh project), see [Seed dataset](./seed-dataset.md).

## Environment

Scripts resolve the project and default dataset from `.env`:

- Prefer `SANITY_PROJECT_ID` and `SANITY_DATASET` if set.
- Otherwise they use `PUBLIC_SANITY_PROJECT_ID` and `PUBLIC_SANITY_DATASET` (the same variables as the app).

You must be logged into the Sanity CLI in the shell where you run the scripts (`npm run sanity:cli -- login`). Dataset operations use your CLI session, not the app's API tokens, and so do the dataset pickers: without a session they fall back to typing the dataset name.

## Safety notes

- **Migration** shows the full plan (source, target, mode, export path) and takes one confirmation before anything runs. In clean mode that confirmation spells out that the target is permanently deleted first, so only accept it when you intend to wipe that dataset.
- **`--clean` snapshots the target first.** Before deleting `--to`, the script exports it to `./backups/<to>-pre-clean-<timestamp>.tar.gz`. If that backup cannot be created (the dataset does not exist yet, or the export fails), an interactive run asks you to confirm before deleting, and a `--yes` run stops with nothing deleted. This snapshot is kept even when the temporary source export is cleaned up.
- **The live dataset needs its name repeated.** A `--clean` or `--replace` migration, or a `--replace` import, into the dataset named in `.env` refuses to run under `--yes` unless `--allow-live-target <that name>` repeats it, and prints the project when it stops; an interactive run asks you to type the name, and `--dry-run` only warns. A typo or a copied command cannot wipe the live site or roll it back to an old backup.
- **Unattended imports name their target.** `npm run sanity:dataset-import -- --replace --yes` refuses to run without `--dataset <name>`; it never falls back to the `.env` dataset.
- **Targets should be private.** Import and migrate read the target's visibility. Clean mode decides before it backs up or deletes anything: when neither the target nor the source reads as private, the plan may have no private datasets, so a `--yes` run stops with nothing deleted unless you pass `--allow-public`, and an interactive run asks. For a public or custom dataset, or one whose visibility cannot be read, an interactive run asks before importing and a `--yes` run stops unless you pass `--allow-public`. Private datasets need a paid Sanity plan; on the Free plan every dataset is public, so confirm or pass the flag. Archives hold every document, contact form submissions included, and a public dataset serves every root-ID document in them without a token.
- Export archives are written under `./backups/` and are git-ignored as `*.tar.gz`. Filenames include a `YYYY-MM-DD-HHMMSS` timestamp, so two runs on the same day never overwrite each other.
- A `--clean` migration recreates the target as **private** when the plan allows it. On a plan without private datasets, `sanity dataset create --visibility private` makes it public with only a CLI warning, so the script also reads the visibility back before importing: a `--yes` run stops (target empty, export kept) unless you pass `--allow-public`, and an interactive run asks. The up-front check above makes that rare. The app reads with `SANITY_API_VIEW_TOKEN`, so it works against a private dataset; keep it that way, since contact form submissions are stored there.
- **Exports contain secrets and personal data.** A full dataset export includes every document, including secret-bearing ones such as the Mux config (`mux.apiKey`, which stores a private signing key and token), preview URL secrets and contact form submissions. Treat `./backups/*.tar.gz` as sensitive: do not commit or share them. The committed [seed dataset](./seed-dataset.md) avoids this by exporting only content types via `--types`, and a test enforces it.
- **Migrations copy contact form submissions.** `migrate` exports every document of the source, so each `contactFormSubmission` (names, emails, messages: personal data), including the dotted-id ones, lands in the target. To leave them out, export the source yourself with a `--types` allowlist that omits `contactFormSubmission` (the seed refresh in `seed/README.md` shows the form), then import that archive: `npm run sanity:cli -- dataset export <from> backups/<from>-content.tar.gz --types <every type except contactFormSubmission>`, followed by `npm run sanity:dataset-import -- --file backups/<from>-content.tar.gz --dataset <to>`.
- **Trimming has the same live-dataset rule.** `npm run trim -- --dataset-only --yes` (or any `--yes` run with `--dataset`) refuses to purge the `.env` dataset without `--allow-live-target <name>`. See [Trimming features](../features/trimming-features.md).
