import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCreateArgs,
  buildDatasetChoices,
  buildDeleteArgs,
  buildExportArgs,
  buildImportArgs,
  buildVisibilityArgs,
  cleanTargetError,
  formatExportTimestamp,
  getImportConfirmationMessage,
  getMigrationMode,
  getSanityEnv,
  importTargetError,
  liveTargetError,
  orderImportChoices,
  parseDatasetList,
  parseDatasetVisibility,
  publicTargetError,
  TYPE_DATASET_NAME,
  validateMigrationOptions,
} from "./lib";

test("getSanityEnv prefers explicit SANITY_* over the app's public pair", () => {
  const env = getSanityEnv({
    SANITY_PROJECT_ID: "explicit",
    SANITY_DATASET: "explicit-ds",
    PUBLIC_SANITY_PROJECT_ID: "public",
    PUBLIC_SANITY_DATASET: "public-ds",
  });

  assert.equal(env.SANITY_PROJECT_ID, "explicit");
  assert.equal(env.SANITY_DATASET, "explicit-ds");
});

test("getSanityEnv falls back to the app's public pair when SANITY_* are absent", () => {
  const env = getSanityEnv({
    PUBLIC_SANITY_PROJECT_ID: "pub",
    PUBLIC_SANITY_DATASET: "pub-ds",
  });

  assert.equal(env.SANITY_PROJECT_ID, "pub");
  assert.equal(env.SANITY_DATASET, "pub-ds");
});

test("getSanityEnv throws when no project id is available", () => {
  assert.throws(() => getSanityEnv({ PUBLIC_SANITY_DATASET: "ds" }));
});

test("validateMigrationOptions rejects --replace combined with --clean", () => {
  const result = validateMigrationOptions({ from: "a", to: "b", replace: true, clean: true });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /cannot be used together/);
});

test("validateMigrationOptions rejects identical source and target", () => {
  const result = validateMigrationOptions({ from: "same", to: "same" });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /cannot be the same/);
});

test("validateMigrationOptions accepts a valid migration", () => {
  assert.deepEqual(validateMigrationOptions({ from: "a", to: "b" }), { success: true });
});

test("getMigrationMode resolves clean > replace > standard precedence", () => {
  assert.equal(getMigrationMode({ clean: true, replace: true }), "clean");
  assert.equal(getMigrationMode({ replace: true }), "replace");
  assert.equal(getMigrationMode({}), "standard");
});

test("buildImportArgs targets the dataset via flag and appends --replace only when requested", () => {
  assert.deepEqual(buildImportArgs("/tmp/x.tar.gz", "prod", {}), ["dataset", "import", "/tmp/x.tar.gz", "--dataset", "prod"]);
  assert.deepEqual(buildImportArgs("/tmp/x.tar.gz", "prod", { replace: true }), [
    "dataset",
    "import",
    "/tmp/x.tar.gz",
    "--dataset",
    "prod",
    "--replace",
  ]);
});

test("buildDeleteArgs and buildCreateArgs target the right dataset", () => {
  assert.deepEqual(buildDeleteArgs("staging"), ["dataset", "delete", "staging", "--force"]);
  assert.deepEqual(buildCreateArgs("staging"), ["dataset", "create", "staging", "--visibility", "private"]);
  assert.deepEqual(buildCreateArgs("staging", "public"), ["dataset", "create", "staging", "--visibility", "public"]);
});

test("buildExportArgs orders source dataset then output path", () => {
  assert.deepEqual(buildExportArgs("prod", "/tmp/prod.tar.gz"), ["dataset", "export", "prod", "/tmp/prod.tar.gz"]);
});

test("formatExportTimestamp includes date and time so same-day runs do not collide", () => {
  assert.equal(formatExportTimestamp(new Date("2026-06-13T14:30:52.123Z")), "2026-06-13-143052");
});

test("formatExportTimestamp produces distinct values for two times on the same day", () => {
  const a = formatExportTimestamp(new Date("2026-06-13T14:30:52.000Z"));
  const b = formatExportTimestamp(new Date("2026-06-13T14:30:53.000Z"));

  assert.notEqual(a, b);
});

test("getImportConfirmationMessage warns about destruction only in clean mode", () => {
  assert.match(getImportConfirmationMessage("staging", "prod", true), /PERMANENTLY DELETE/);
  assert.doesNotMatch(getImportConfirmationMessage("staging", "prod", false), /PERMANENTLY DELETE/);
});

test("orderImportChoices lists the seed first, then backups newest first", () => {
  const choices = orderImportChoices(true, [
    { name: "production-2026-06-10-000000.tar.gz", mtimeMs: 10 },
    { name: "production-2026-06-15-000000.tar.gz", mtimeMs: 50 },
  ]);

  assert.deepEqual(choices, [
    { title: "seed/seed-dataset.tar.gz (bundled starter content)", value: "seed/seed-dataset.tar.gz" },
    { title: "backups/production-2026-06-15-000000.tar.gz", value: "backups/production-2026-06-15-000000.tar.gz" },
    { title: "backups/production-2026-06-10-000000.tar.gz", value: "backups/production-2026-06-10-000000.tar.gz" },
  ]);
});

test("orderImportChoices omits the seed when it is absent", () => {
  assert.deepEqual(orderImportChoices(false, [{ name: "a.tar.gz", mtimeMs: 1 }]), [
    { title: "backups/a.tar.gz", value: "backups/a.tar.gz" },
  ]);
});

test("parseDatasetList keeps dataset names and drops CLI noise, banners and aliases", () => {
  const stdout = [
    "[dotenvx@2.19.2] injecting env (7) from .env",
    "production",
    "staging",
    "dev_2",
    "~live -> production",
    "No datasets found for this project.",
    "",
  ].join("\n");

  assert.deepEqual(parseDatasetList(stdout), ["production", "staging", "dev_2"]);
});

test("parseDatasetList strips ANSI colour codes and de-duplicates", () => {
  assert.deepEqual(parseDatasetList("\u001B[32mproduction\u001B[39m\nproduction\n"), ["production"]);
});

test("parseDatasetList returns nothing when the output has no dataset names", () => {
  assert.deepEqual(parseDatasetList("No datasets found for this project.\n"), []);
});

test("buildDatasetChoices lists the .env dataset first and always offers a typed name", () => {
  assert.deepEqual(buildDatasetChoices(["staging", "production"], { current: "production" }), [
    { title: "production (from .env)", value: "production" },
    { title: "staging", value: "staging" },
    { title: "Other (type a name)", value: TYPE_DATASET_NAME },
  ]);
});

test("buildDatasetChoices keeps the given order when the current dataset is not listed", () => {
  assert.deepEqual(buildDatasetChoices(["staging"], { current: "production", typeNameLabel: "Type a name" }), [
    { title: "staging", value: "staging" },
    { title: "Type a name", value: TYPE_DATASET_NAME },
  ]);
});

test("buildDatasetChoices offers the typed name even with no datasets", () => {
  assert.deepEqual(buildDatasetChoices([]), [{ title: "Other (type a name)", value: TYPE_DATASET_NAME }]);
});

// Matched on the suffix, so these scripts read the app's own values in any host, not just this project's prefix.
test("getSanityEnv reads the public pair under whatever prefix the host gives it", () => {
  for (const prefix of ["PUBLIC_", "NEXT_PUBLIC_", "VITE_PUBLIC_"]) {
    const env = { [`${prefix}SANITY_PROJECT_ID`]: "pid", [`${prefix}SANITY_DATASET`]: "ds" };

    assert.deepEqual(getSanityEnv(env), { SANITY_PROJECT_ID: "pid", SANITY_DATASET: "ds" });
  }
});

test("liveTargetError refuses --clean, --replace and a purge on the .env dataset unless the flag repeats its name", () => {
  const live = { target: "production", liveDataset: "production" };

  assert.match(liveTargetError({ ...live, mode: "clean" }) ?? "", /--allow-live-target production/);
  assert.match(liveTargetError({ ...live, mode: "replace" }) ?? "", /--allow-live-target production/);
  assert.match(
    liveTargetError({ ...live, mode: "purge" }) ?? "",
    /Purging documents from it needs --allow-live-target production/
  );
  assert.notEqual(liveTargetError({ ...live, mode: "clean", allowLiveTarget: "staging" }), null);
  assert.notEqual(liveTargetError({ ...live, mode: "clean", allowLiveTarget: "" }), null);
  assert.notEqual(liveTargetError({ ...live, mode: "purge", allowLiveTarget: "Production" }), null);
  assert.equal(liveTargetError({ ...live, mode: "clean", allowLiveTarget: "production" }), null);
  assert.equal(liveTargetError({ ...live, mode: "purge", allowLiveTarget: "production" }), null);
  assert.equal(liveTargetError({ ...live, mode: "replace", allowLiveTarget: "production" }), null);
  assert.equal(liveTargetError({ ...live, mode: "standard" }), null);
  assert.equal(liveTargetError({ target: "staging", liveDataset: "production", mode: "clean" }), null);
});

test("parseDatasetVisibility reads the visibility line through banners and colour codes", () => {
  assert.equal(parseDatasetVisibility("private\n"), "private");
  assert.equal(parseDatasetVisibility("[dotenvx@1.0.0] injecting env (3) from .env\n\u001B[32mpublic\u001B[39m\n"), "public");
  assert.equal(parseDatasetVisibility("custom"), "custom");
  assert.equal(parseDatasetVisibility("Dataset not found: nope"), null);
  assert.equal(parseDatasetVisibility("the dataset is public"), null);
  assert.equal(parseDatasetVisibility(""), null);
  assert.deepEqual(buildVisibilityArgs("staging"), ["dataset", "visibility", "get", "staging"]);
});

test("publicTargetError refuses a public, custom or unknown target unless --allow-public", () => {
  assert.equal(publicTargetError("staging", "private", false), null);
  assert.match(publicTargetError("staging", "custom", false) ?? "", /CUSTOM access control list/);
  assert.equal(publicTargetError("staging", "custom", true), null);
  assert.match(publicTargetError("staging", "public", false) ?? "", /PUBLIC/);
  assert.match(publicTargetError("staging", null, false) ?? "", /Could not read the visibility/);
  assert.equal(publicTargetError("staging", "public", true), null);
  assert.equal(publicTargetError("staging", null, true), null);
});

test("cleanTargetError trusts a private target or source, and refuses otherwise unless --allow-public", () => {
  assert.equal(cleanTargetError("staging", { target: "private", source: "public" }, false), null);
  assert.equal(cleanTargetError("staging", { target: null, source: "private" }, false), null);
  assert.match(cleanTargetError("staging", { target: "public", source: "public" }, false) ?? "", /PUBLIC/);
  assert.match(cleanTargetError("staging", { target: null, source: null }, false) ?? "", /--allow-public/);
  assert.match(cleanTargetError("staging", { target: "custom", source: "public" }, false) ?? "", /PUBLIC/);
  assert.equal(cleanTargetError("staging", { target: "public", source: "public" }, true), null);
});

test("migrate decides a clean target's visibility before it backs up or deletes anything", () => {
  const source = readFileSync(new URL("./migrate.ts", import.meta.url), "utf8");
  const guard = source.indexOf("cleanTargetError(to");

  assert.ok(guard > 0, "migrate.ts no longer calls cleanTargetError");
  assert.ok(guard < source.indexOf("buildExportArgs(to"), "the guard runs after the target backup");
  assert.ok(guard < source.indexOf("buildDeleteArgs(to)"), "the guard runs after the delete");
});

test("importTargetError needs an explicit --dataset for an unattended --replace", () => {
  assert.match(importTargetError({ replace: true, interactive: false }) ?? "", /--dataset/);
  assert.match(importTargetError({ replace: true, interactive: false, datasetFlag: "" }) ?? "", /--dataset/);
  assert.equal(importTargetError({ replace: true, interactive: false, datasetFlag: "staging" }), null);
  assert.equal(importTargetError({ replace: false, interactive: false }), null);
  assert.equal(importTargetError({ replace: true, interactive: true }), null);
});

test("dataset exports land in a folder git ignores, since they hold personal data and secrets", () => {
  const folder = (script: string) =>
    readFileSync(new URL(script, import.meta.url), "utf8").match(/backupsDir = join\(process\.cwd\(\), "([^"]+)"\)/)?.[1];
  const ignored = new Set(
    readFileSync(new URL("../../.gitignore", import.meta.url), "utf8")
      .split("\n")
      .map((line) => line.trim())
  );

  for (const script of ["./export.ts", "./migrate.ts"]) {
    const name = folder(script);

    assert.ok(name, `${script} no longer names its backups folder the way this test reads it`);
    assert.ok(
      ignored.has(`/${name}`) || ignored.has(`/${name}/`),
      `${script} writes to ${name}/, which .gitignore does not cover`
    );
  }
});
