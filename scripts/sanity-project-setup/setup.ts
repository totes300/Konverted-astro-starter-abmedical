#!/usr/bin/env node
/**
 * Interactive Sanity bootstrap: project, tokens, CORS, `.env` (with generated secrets) and the seed content.
 * Prerequisites: `npm run sanity:cli -- login`. See `scripts/sanity-project-setup/README.md`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import ora from "ora";
import {
  askConfirm,
  askSelect,
  askText,
  confirmOrCancel,
  fail,
  finishDryRun,
  printDryRunNotice,
  printHeader,
  printStep,
  printSummary,
  SKIPPED,
  type SummaryRow,
} from "../lib/cli";
import { buildVisibilityArgs, parseDatasetVisibility } from "../sanity-dataset/lib";
import { detectRole, originRepository, readProjectRecord, today, writeProjectRecord } from "../trim-features/project";
import {
  corsOriginKind,
  ensureEnvFromExample,
  envSecretStatus,
  generateEnvSecret,
  parseCreatedToken,
  parseJsonFromCliOutput,
  readLocalSiteOrigin,
  readPublicEnvPrefix,
  runSanityCli,
  runSanityCliStreaming,
  upsertEnvFile,
} from "./lib";

const DEFAULT_DATASET = "production";
const DEFAULT_STUDIO_PATH = "/studio";
/** Only the fallback: the real default is the dev origin `.env.example` points at. CORS origin only. */
const FALLBACK_LOCAL_SITE_ORIGIN = "http://localhost:4321";
const DEFAULT_CREATE_TOKENS = true;
const DEFAULT_ADD_CORS = true;
/** Bundled starter content. Relative on purpose: it is also the path printed in the retry command. */
const SEED_ARCHIVE_PATH = "seed/seed-dataset.tar.gz";
const GENERATED_SECRETS = [
  {
    key: "SANITY_REVALIDATE_SECRET",
    use: "use the same value as the secret of the publish webhook",
    replaceIn: "here, in your host, and in the webhook",
  },
] as const;
/** Mirrors the floor in the app's env validation. */
const MIN_SECRET_LENGTH = 32;

const program = new Command();

program
  .name("project-setup")
  .description("Bootstrap a Sanity project: tokens, CORS, .env, and the seed content")
  .option("--dry-run", "Walk through the questions, print the summary, then exit without writing", false)
  .version("1.3.0");

program.parse();

const options = program.opts<{ dryRun: boolean }>();
const isDryRun = options.dryRun;

function parseProjectId(obj: Record<string, unknown>): string {
  const fromProject = obj.projectId;
  const fromId = obj.id;
  let id = "";

  if (typeof fromProject === "string" && fromProject) {
    id = fromProject;
  } else if (typeof fromId === "string" && fromId) {
    id = fromId;
  }

  if (!id) {
    throw new Error("Unexpected project response from the Sanity CLI (missing projectId).");
  }

  return id;
}

/** Quoted so a pasted `cors delete` never lets the shell expand a wildcard origin. */
function shellQuote(origin: string): string {
  return origin.includes("*") ? `'${origin}'` : origin;
}

type CreatedToken = { id: string; label: string; projectId: string; keep: boolean; revoked: boolean };

/** Every token this run created. Anything not kept (written to `.env`) is revoked, on every exit path. */
const createdTokens: CreatedToken[] = [];

/** Synchronous (spawnSync), so it also runs from the `exit` hook that `fail()` and `process.exit` reach. */
function revokeUnkeptTokens(): void {
  for (const token of createdTokens) {
    if (token.keep || token.revoked) {
      continue;
    }

    token.revoked = true;
    const del = ora(`Removing token “${token.label}”…`).start();
    const rm = runSanityCli(["tokens", "delete", token.id, "--yes", "-p", token.projectId]);

    if (rm.ok) {
      del.succeed(`Removed token “${token.label}”`);
    } else {
      del.warn(`Could not remove token “${token.label}” automatically`);
      console.log(`   ℹ️  Delete “${token.label}” manually in Manage → API → Tokens.\n`);
    }
  }
}

/** Creates a robot token and records it for cleanup; failures never print CLI stdout, which may hold the secret. */
function createToken(projectId: string, label: string, role: string): string {
  const s = ora(`Creating token “${label}”…`).start();
  const result = runSanityCli(["tokens", "add", label, `--role=${role}`, "--yes", "--json", "-p", projectId]);

  if (!result.ok) {
    s.fail(`Token “${label}” failed`);
    fail(
      "Token creation failed.",
      result.stderr.trim() || `Sanity CLI exited with code ${result.status ?? 1}.`,
      `If it was interrupted, check Manage → API → Tokens for an orphaned “${label}”.`
    );
  }

  try {
    const parsed = parseJsonFromCliOutput(result.stdout);

    if (typeof parsed.id === "string" && parsed.id) {
      createdTokens.push({ id: parsed.id, label, projectId, keep: false, revoked: false });
    }

    const { secret } = parseCreatedToken(parsed);
    s.succeed(`Token “${label}” created`);

    return secret;
  } catch (e) {
    s.fail(`Invalid response for token “${label}”`);
    fail(
      "Could not read the created token.",
      e instanceof Error ? e.message : "Unknown error.",
      `Check Manage → API → Tokens for an orphaned “${label}”.`
    );
  }
}

async function main() {
  // Both host facts come from `.env.example`, which is what lets this script run unchanged in any host.
  const examplePath = join(process.cwd(), ".env.example");
  const exampleContents = existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "";
  const publicPrefix = readPublicEnvPrefix(exampleContents);
  const localSiteOrigin = readLocalSiteOrigin(exampleContents, FALLBACK_LOCAL_SITE_ORIGIN);

  printHeader("🛠️", "Sanity project setup", [
    "Tokens, CORS, `.env`, and the seed content, step by step.",
    "",
    `Quick defaults (Enter):  dataset ${DEFAULT_DATASET} · private · tokens · CORS ${localSiteOrigin} · seed content.`,
    "",
    "Private is the default: the dataset holds contact form submissions (names, emails, messages) and more.",
  ]);

  if (isDryRun) {
    printDryRunNotice();
  }

  const projectMode = await askSelect(
    "How do you want to start?",
    [
      { title: "Create a new Sanity project", value: "new" as const },
      { title: "Use an existing project ID", value: "existing" as const },
    ],
    { initial: 0 }
  );

  let organization = "";
  let projectName = "";
  let dataset = DEFAULT_DATASET;
  let datasetVisibility: "public" | "private" = "private";
  let projectId = "";

  if (projectMode === "new") {
    organization = await askText("Organization id or slug (from sanity.io/manage)", { required: true });
    projectName = await askText("Project display name", { required: true });
    dataset = (await askText("Initial dataset name", { initial: DEFAULT_DATASET })) || DEFAULT_DATASET;
    datasetVisibility = await askSelect(
      "Dataset visibility",
      [
        {
          title: "Private (reads need a token; recommended)",
          value: "private" as const,
          description: "The app reads with its own token; a paid plan feature (included in the Growth trial)",
        },
        {
          title: "Public (anyone can query published documents)",
          value: "public" as const,
          description: "Every root-ID document is readable without a token, including any old contact form submission",
        },
      ],
      { initial: 0 }
    );
  } else {
    projectId = await askText("Existing project ID", { required: true });
    dataset = (await askText(`Dataset name for ${publicPrefix}SANITY_DATASET`, { initial: DEFAULT_DATASET })) || DEFAULT_DATASET;
  }

  const createTokens = await askConfirm("Create API tokens (Frontend - View + Frontend - Edit)?", DEFAULT_CREATE_TOKENS);
  const addCors = await askConfirm("Add CORS origins (Studio + browser token)?", DEFAULT_ADD_CORS);

  let corsOrigins: string[] = [localSiteOrigin];
  let localCredentials = false;
  let wildcardCredentials = false;

  if (addCors) {
    const origins = await askText("Comma-separated origins (browser + Studio)", { initial: localSiteOrigin });

    corsOrigins = origins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (corsOrigins.length === 0) {
      corsOrigins = [localSiteOrigin];
    }

    const localOrigins = corsOrigins.filter((origin) => corsOriginKind(origin) === "loopback");
    const wildcardOrigins = corsOrigins.filter((origin) => corsOriginKind(origin) === "wildcard");

    if (localOrigins.length > 0) {
      console.log(
        `\n   The local Studio needs credentials on ${localOrigins.join(", ")}, but then any app served there can act as you.\n   Remove it after launch: npm run sanity:cli -- cors delete ${localOrigins[0]}\n`
      );
      localCredentials = await askConfirm(`Allow credentials for ${localOrigins.join(", ")}?`, projectMode === "new");
    }

    if (wildcardOrigins.length > 0) {
      console.log(
        `\n   ${wildcardOrigins.join(", ")} also match origins you did not list; with credentials, any site they match can act as you.\n   Prefer exact origins. Remove it after launch: npm run sanity:cli -- cors delete ${shellQuote(wildcardOrigins[0] ?? "")}\n`
      );
      wildcardCredentials = await askConfirm(`Allow credentials for ${wildcardOrigins.join(", ")}?`, false);
    }
  }

  const allowsCredentials = (origin: string): boolean => {
    const kind = corsOriginKind(origin);

    if (kind === "wildcard") {
      return wildcardCredentials;
    }

    return kind === "loopback" ? localCredentials : true;
  };

  const seedAvailable = existsSync(join(process.cwd(), SEED_ARCHIVE_PATH));
  let importSeed = false;

  if (seedAvailable) {
    const isExisting = projectMode === "existing";

    importSeed = await askSelect(
      isExisting ? `How should "${dataset}" start? It may already hold content.` : "How should the dataset start?",
      [
        {
          title: "With the bundled example content",
          value: true,
          description: isExisting
            ? "REPLACES site, siteSettings, homepage, blog and every other same-ID document"
            : `Imports ${SEED_ARCHIVE_PATH}: example pages, the site singletons, the blog, and their assets`,
        },
        { title: "Completely empty", value: false, description: "Nothing is imported; existing content is untouched" },
      ],
      { initial: isExisting ? 1 : 0 }
    );

    // An existing project's dataset may be the live site, so overwriting it takes its name typed back.
    if (importSeed && isExisting) {
      const typed = await askText(`Type "${dataset}" to confirm replacing its same-ID documents with the seed`, {
        required: true,
      });

      if (typed !== dataset) {
        importSeed = false;
        console.log("\n⏭️  The name did not match, so the seed import is off.\n");
      }
    }
  }

  const envPath =
    (await askText("Path to .env to update", { initial: join(process.cwd(), ".env") })) || join(process.cwd(), ".env");

  // The day a project is cut is what lets `npm run trim` tell the starter's features from its own later.
  const trimRecord = readProjectRecord(process.cwd());
  const isUncutClone = !trimRecord.starter.cutFrom && Boolean(trimRecord.starter.repository);
  const stampCut =
    isUncutClone &&
    (detectRole(trimRecord, originRepository(process.cwd())) === "project" ||
      (await askConfirm("Is this a new site cut from the starter, rather than work on the starter itself?", true)));

  const summary: SummaryRow[] = [];

  if (projectMode === "new") {
    summary.push({ value: `New project “${projectName}” in org ${organization}` });
    summary.push({
      label: "Dataset",
      value: `${dataset} (${datasetVisibility === "private" ? "private if the plan allows it, checked after creation" : "public"})`,
    });
  } else {
    summary.push({ label: "Project ID", value: projectId });
    summary.push({ label: "Dataset", value: dataset });
  }

  summary.push({ label: "API tokens", value: createTokens ? "✅ viewer + editor" : SKIPPED });
  summary.push({
    label: "CORS",
    value: addCors
      ? corsOrigins.map((origin) => `${origin} (${allowsCredentials(origin) ? "credentials" : "no credentials"})`).join(", ")
      : SKIPPED,
  });

  let seedSummary = projectMode === "existing" ? "Left as it is (no seed import)" : "Empty dataset";

  if (importSeed) {
    seedSummary = `✅ ${SEED_ARCHIVE_PATH} → ${dataset} (replaces documents with the same IDs)`;
  } else if (!seedAvailable && projectMode === "new") {
    seedSummary = `Empty dataset (no ${SEED_ARCHIVE_PATH} in this checkout)`;
  }

  summary.push({ label: "Content", value: seedSummary });
  summary.push({ label: "Env file", value: envPath });
  summary.push({
    label: "Secrets",
    value: `${GENERATED_SECRETS.map((secret) => secret.key).join(", ")} generated where ${envPath} has none`,
  });

  if (stampCut) {
    summary.push({ label: "Starter cut", value: `${today()} (recorded for npm run trim)` });
  }

  printSummary(summary);

  if (isDryRun) {
    finishDryRun();
  }

  await confirmOrCancel("Run these steps now?", { initial: true });

  if (projectMode === "new") {
    const spinner = ora("Creating Sanity project…").start();
    const created = runSanityCli([
      "projects",
      "create",
      projectName,
      "--organization",
      organization,
      "--dataset",
      dataset,
      "--dataset-visibility",
      datasetVisibility,
      "--yes",
      "--json",
    ]);

    if (!created.ok) {
      spinner.fail("Project creation failed");
      fail("Project creation failed.", created.stderr.trim() || `Sanity CLI exited with code ${created.status ?? 1}.`);
    }

    try {
      projectId = parseProjectId(parseJsonFromCliOutput(created.stdout));
    } catch (e) {
      spinner.fail("Could not parse project response");
      fail("Could not read the created project.", e instanceof Error ? e.message : "Unknown error.");
    }

    spinner.succeed(`Project created, id ${projectId}`);
  } else {
    console.log(`\n✅ Using project ${projectId}\n`);
  }

  let viewToken = "";
  let editToken = "";

  if (createTokens) {
    process.once("exit", revokeUnkeptTokens);
    process.once("SIGINT", () => process.exit(130));
    viewToken = createToken(projectId, "Frontend - View", "viewer");
    editToken = createToken(projectId, "Frontend - Edit", "editor");

    console.log("");
  } else {
    console.log("⏭️  Skipping token creation. Ensure SANITY_API_* are in .env if you need them.\n");
  }

  const launchCleanupOrigins: string[] = [];

  if (addCors) {
    for (const origin of corsOrigins) {
      const kind = corsOriginKind(origin);
      const credentials = allowsCredentials(origin);
      const needsLaunchCleanup = kind === "wildcard" || (kind === "loopback" && credentials);
      const s = ora(`CORS: ${origin}`).start();
      const cors = runSanityCli(["cors", "add", origin, credentials ? "--credentials" : "--no-credentials", "-p", projectId]);

      if (!cors.ok) {
        if (/exist|already|duplicate/i.test(`${cors.stderr}${cors.stdout}`)) {
          s.warn(`Already present or similar: ${origin} (its credentials setting was left as it is)`);

          // Answering no does not downgrade an origin already registered with credentials.
          if (kind !== "remote") {
            launchCleanupOrigins.push(origin);
          }
        } else {
          s.fail("CORS failed");
          fail(
            `Could not add the CORS origin ${origin}.`,
            cors.stderr.trim() || `Sanity CLI exited with code ${cors.status ?? 1}.`
          );
        }
      } else {
        s.succeed(`CORS added: ${origin}${credentials ? " (credentials)" : ""}`);

        if (needsLaunchCleanup) {
          launchCleanupOrigins.push(origin);
        }
      }
    }
    console.log("");
  }

  const apiVersion = process.env[`${publicPrefix}SANITY_API_VERSION`] ?? "2025-02-19";

  const updates: Record<string, string> = {
    [`${publicPrefix}SANITY_PROJECT_ID`]: projectId,
    [`${publicPrefix}SANITY_DATASET`]: dataset,
    [`${publicPrefix}SANITY_API_VERSION`]: apiVersion,
    [`${publicPrefix}SANITY_STUDIO_BASE_PATH`]: DEFAULT_STUDIO_PATH,
  };

  if (createTokens) {
    updates.SANITY_API_VIEW_TOKEN = viewToken;
    updates.SANITY_API_EDIT_TOKEN = editToken;
  }

  if (ensureEnvFromExample(envPath, examplePath)) {
    console.log(`📄 Created ${envPath} from .env.example\n`);
  } else if (!existsSync(envPath)) {
    console.log(`📄 Creating ${envPath}\n`);
  }

  const envContents = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const secrets = GENERATED_SECRETS.map((secret) => ({
    ...secret,
    status: envSecretStatus(envContents, secret.key, MIN_SECRET_LENGTH),
  }));

  for (const secret of secrets) {
    if (secret.status === "missing") {
      updates[secret.key] = generateEnvSecret();
    }
  }

  upsertEnvFile(envPath, updates);

  for (const token of createdTokens) {
    token.keep = true;
  }

  console.log(`✅ Updated ${envPath}\n`);

  for (const secret of secrets) {
    if (secret.status === "missing") {
      console.log(`🔑 Generated ${secret.key}; ${secret.use}.\n`);
    } else if (secret.status === "short") {
      console.warn(
        `⚠️  ${secret.key} is shorter than ${MIN_SECRET_LENGTH} characters, which the app refuses.\n   Replace it (openssl rand -hex 32) ${secret.replaceIn}.\n`
      );
    }
  }

  // Read back, never assumed: the CLI creates a public dataset (with only a warning) when the plan has no private ones.
  const visibility = runSanityCli([...buildVisibilityArgs(dataset), "-p", projectId]);
  const aclMode = visibility.ok ? parseDatasetVisibility(visibility.stdout) : null;
  const isPrivate = aclMode === "private";
  const chosePublic = projectMode === "new" && datasetVisibility === "public";

  if (!isPrivate && !chosePublic) {
    const state =
      projectMode === "new" && aclMode === "public"
        ? "was created PUBLIC: Sanity falls back to public when the plan has no private datasets (Free, or a used-up Growth trial)"
        : `is ${aclMode ?? "of unknown visibility"}, not private`;

    console.warn(
      `⚠️  "${dataset}" ${state}. Its root-ID documents, contact form submissions included, are readable without a token.\n   Make it private (needs a paid plan): npm run sanity:cli -- dataset visibility set ${dataset} private\n`
    );
  }

  if (stampCut) {
    writeProjectRecord(process.cwd(), { ...trimRecord, starter: { ...trimRecord.starter, cutFrom: today() } });
    console.log(`✅ Recorded the starter cut (${today()}) for \`npm run trim\`\n`);
  }

  if (importSeed && projectMode === "existing" && !isPrivate) {
    importSeed = await askConfirm(`Import the seed into "${dataset}" even though it is not private?`, false);

    if (!importSeed) {
      console.log("\n⏭️  Seed import skipped.\n");
    }
  }

  if (importSeed) {
    printStep("📥", `Importing the seed content into "${dataset}"…`);

    // The flags override a CLI config still holding the pre-run env; the env pair keeps `sanity.cli.ts` resolvable with no `.env`.
    const seed = runSanityCliStreaming(
      ["dataset", "import", SEED_ARCHIVE_PATH, "--dataset", dataset, "--replace", "-p", projectId],
      { [`${publicPrefix}SANITY_PROJECT_ID`]: projectId, [`${publicPrefix}SANITY_DATASET`]: dataset }
    );

    if (!seed.ok) {
      fail(
        `Seed import failed${seed.error ? `: ${seed.error}` : "."}`,
        "Everything above it is already done, so do not re-run the whole wizard.",
        `Retry the import with: npm run sanity:dataset-import -- --file ${SEED_ARCHIVE_PATH} --dataset ${dataset} --replace${isPrivate ? "" : " --allow-public"}`
      );
    }

    console.log(`\n✅ Seeded "${dataset}" from ${SEED_ARCHIVE_PATH}\n`);
  }

  console.log("🎉 Done.\n");
  console.log("   Next: `npm run sanity:typegen`\n");

  for (const origin of launchCleanupOrigins) {
    console.log(
      `   After launch, remove the dev or wildcard origin (it may allow credentials): npm run sanity:cli -- cors delete ${shellQuote(origin)}\n`
    );
  }

  if (seedAvailable && !importSeed) {
    console.log(`   Changed your mind? npm run sanity:dataset-import -- --file ${SEED_ARCHIVE_PATH}\n`);
  }
}

main().catch((err) => {
  fail("Unexpected error.", err instanceof Error ? (err.stack ?? err.message) : String(err));
});
