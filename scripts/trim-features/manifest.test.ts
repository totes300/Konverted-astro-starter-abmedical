/**
 * The manifest checked against the repository it describes. In the starter every anchor must resolve;
 * in a project only what the project owns is asserted, and anchor drift is `--status`'s to report.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { describeEdit, verifyEdits } from "./edits";
import {
  FEATURES,
  findFeature,
  findMissingLandmarks,
  findSelectionConflicts,
  isFeaturePresent,
  manifestLandmarks,
  onDisk,
  resolveSelection,
  sectionNamesOf,
} from "./features";
import { buildImportIndex } from "./importers";
import {
  detectRole,
  findOutsideImporters,
  findRecordConflicts,
  findUnaccountedSections,
  findUnaccountedTypes,
  isDate,
  isOfferable,
  listSections,
  originRepository,
  PROJECT_FILE,
  readProjectRecord,
  statusesOf,
} from "./project";
import { isSystemType, parseDeclaredFields, parseRegisteredTypes } from "./schema";

const root = join(import.meta.dirname, "..", "..");
const exists = (path: string) => existsSync(join(root, path));

function read(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

const record = readProjectRecord(root);
const role = detectRole(record, originRepository(root));
const statuses = statusesOf(record, exists);

// The starter must describe itself exactly. A project has changed what it kept, so there the per-feature
// assertions are skipped with a pointer to the report that shows the same drift without failing.
const starterOnly = role === "starter" ? {} : { skip: "a project reports drift with `npm run trim -- --status`" };

// Once a feature has actually been removed its entry is inert, and asserting its anchors would turn a
// successful trim into a red test suite.
const present = FEATURES.filter((feature) => isOfferable(statuses.get(feature.id) ?? "present"));

test("the manifest still describes at least one feature that is present", starterOnly, () => {
  // A guard on the guard: if `isPresent` ever silently matched nothing, every check below would
  // pass vacuously and the manifest would rot unnoticed.
  assert.ok(present.length > 0, "no feature in the manifest is present in this tree");
});

test("every feature id is unique and kebab/namespace shaped", () => {
  const ids = FEATURES.map((feature) => feature.id);

  assert.equal(new Set(ids).size, ids.length, "duplicate feature id");

  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+(:[a-z0-9-]+)?$/, `unexpected id shape: ${id}`);
  }
});

test("every implied feature id resolves to a real entry", () => {
  for (const feature of FEATURES) {
    for (const id of feature.implies ?? []) {
      assert.ok(findFeature(id), `${feature.id} implies unknown feature "${id}"`);
    }
  }
});

// The other direction. Every test below asks whether what the manifest declares is still here, and
// none asks whether what is here is declared, which is the half a growing repository breaks.
test("every page-builder section is declared, so a new one cannot ship unremovable", () => {
  const sections = listSections(root);

  assert.ok(sections.length > 0, "no page-builder sections on disk");

  const undeclared = findUnaccountedSections(sections, record, statuses);

  assert.deepEqual(
    undeclared,
    [],
    `no manifest entry, so \`npm run trim\` cannot tell whose these are:\n  ${undeclared.join("\n  ")}\n` +
      (role === "starter"
        ? "Starter kit needs an entry in `features.ts`. If this repository is a project, run `npm run trim -- --reconcile`."
        : `Record them as this project's with \`npm run trim -- --reconcile\` (plop does it for scaffolded ones).`)
  );
});

test("every document type the schema registers is removable, core, or this project's own", () => {
  const unaccounted = findUnaccountedTypes(parseRegisteredTypes(read("sanity-schema.json")), record, statuses, isSystemType);

  assert.deepEqual(
    unaccounted,
    [],
    `neither removable, core, nor recorded in ${PROJECT_FILE}:\n  ${unaccounted.join("\n  ")}\n` +
      (role === "starter"
        ? "Starter kit needs a `documentTypes` entry or a place in `CORE_DOCUMENT_TYPES`."
        : "Record them as this project's with `npm run trim -- --reconcile`.")
  );
});

test("project.json names only sections and types that exist, so it cannot hide a rename", () => {
  // An exemption for something that is gone would go on excusing whatever takes that name next.
  const sections = new Set(listSections(root));
  const registered = new Set(parseRegisteredTypes(read("sanity-schema.json")));
  const stale = [
    ...record.sections.filter((name) => !sections.has(name)),
    ...record.documentTypes.filter((type) => !registered.has(type)),
  ];

  assert.deepEqual(stale, [], `recorded in ${PROJECT_FILE} but not here:\n  ${stale.join("\n  ")}`);
});

test("project.json agrees with the tree", () => {
  assert.deepEqual(findRecordConflicts(record, exists), []);
});

test("every conditional note names a real feature", () => {
  for (const feature of FEATURES) {
    for (const note of feature.notes ?? []) {
      if (typeof note !== "string") {
        assert.ok(findFeature(note.unless), `${feature.id}: a note is dropped unless "${note.unless}", which is not a feature`);
      }
    }
  }
});

test("every stored field is removed by a schema edit of the same feature, and every removed field is declared", () => {
  // The purge can only unset what the manifest names, so a field the schema edit drops without a
  // declaration would be left in the dataset for the Studio to show as unknown.
  for (const feature of FEATURES) {
    const dropped = feature.edits.flatMap((entry) =>
      entry.file.startsWith("sanity/schemas/documents/")
        ? entry.edits.flatMap((edit) => (edit.kind === "dropFieldByName" ? [edit.name] : []))
        : []
    );
    const declared = (feature.fields ?? []).map((field) => field.name);

    assert.deepEqual(dropped.sort(), declared.sort(), `${feature.id}: dropFieldByName edits and \`fields\` disagree`);
  }
});

test("every declared stored field is one its document type declares today", starterOnly, () => {
  const declared = parseDeclaredFields(read("sanity-schema.json"));

  for (const feature of present) {
    for (const field of feature.fields ?? []) {
      assert.ok(
        declared.get(field.documentType)?.has(field.name),
        `${feature.id}: ${field.documentType}.${field.name} is not in the extracted schema`
      );
    }
  }
});

test("every feature says when it joined the starter", () => {
  for (const feature of FEATURES) {
    assert.ok(isDate(feature.since), `${feature.id}: since must be a YYYY-MM-DD date, not "${feature.since}"`);
  }
});

test("every declared path exists on disk", starterOnly, () => {
  for (const feature of present) {
    for (const path of feature.paths) {
      assert.ok(onDisk(path, exists).length > 0, `${feature.id}: missing path ${path}`);
    }
  }
});

test("every edited file exists and every anchor resolves exactly once", starterOnly, () => {
  const failures: string[] = [];

  for (const feature of present) {
    for (const { file, edits, optional, requires } of feature.edits) {
      if (requires && !existsSync(join(root, requires))) {
        continue;
      }

      if (!existsSync(join(root, file))) {
        if (!optional) {
          failures.push(`${feature.id}: missing file ${file}`);
        }

        continue;
      }

      for (const { edit, matches } of verifyEdits(read(file), edits, file)) {
        failures.push(`${feature.id} · ${file}: ${describeEdit(edit)} matched ${matches} times`);
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("nothing outside a feature imports what it deletes", starterOnly, () => {
  // The static half of `trim:verify`: a file outside the selection importing it breaks the build.
  const index = buildImportIndex(root);
  const reaching = FEATURES.flatMap((feature) =>
    findOutsideImporters(index, resolveSelection([feature.id]).features).map(
      ({ file, target }) => `${feature.id}: ${file} imports ${target}`
    )
  );

  assert.deepEqual(reaching, []);
});

test("every declared dependency is a real dependency", starterOnly, () => {
  const manifest = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const installed = { ...manifest.dependencies, ...manifest.devDependencies };

  for (const feature of present) {
    for (const name of feature.dependencies ?? []) {
      assert.ok(name in installed, `${feature.id}: ${name} is not in package.json`);
    }
  }
});

test("every declared env var is wired into the config schema, env.ts and .env.example", starterOnly, () => {
  const schema = read("astro.config.mjs");
  const envTs = read("src/lib/env.ts");
  const envExample = read(".env.example");

  for (const feature of present) {
    for (const name of feature.env ?? []) {
      assert.ok(schema.includes(`${name}: envField.`), `${feature.id}: ${name} is not in the astro.config.mjs schema`);
      assert.ok(envTs.includes(name), `${feature.id}: ${name} is not re-exported from src/lib/env.ts`);
      assert.ok(envExample.includes(`${name}=`), `${feature.id}: ${name} is not in .env.example`);
    }
  }
});

test("every declared orphan exists, so a shared layer that moved is not reported as still here", starterOnly, () => {
  for (const feature of present) {
    for (const path of feature.orphans ?? []) {
      assert.ok(existsSync(join(root, path)), `${feature.id}: missing orphan ${path}`);
    }
  }
});

test("every declared doc and skill exists", starterOnly, () => {
  for (const feature of present) {
    for (const doc of feature.docs ?? []) {
      assert.ok(existsSync(join(root, doc)), `${feature.id}: missing doc ${doc}`);
    }

    for (const skill of feature.skills ?? []) {
      assert.ok(existsSync(join(root, ".agents", "skills", skill)), `${feature.id}: missing skill ${skill}`);
    }
  }
});

test("every declared document type is a registered schema", starterOnly, () => {
  const schema = read("sanity-schema.json");

  for (const feature of present) {
    for (const type of feature.documentTypes ?? []) {
      assert.ok(schema.includes(`"${type}"`), `${feature.id}: ${type} is not in the extracted schema`);
    }
  }
});

test("every declared section type is a page-builder array member", starterOnly, () => {
  const schema = read("sanity-schema.json");

  for (const feature of present) {
    for (const type of feature.sectionTypes ?? []) {
      assert.ok(schema.includes(`"${type}"`), `${feature.id}: ${type} is not in the extracted schema`);
    }
  }
});

test("resolveSelection closes over implies in both directions", () => {
  const fromBlog = resolveSelection(["blog"]);

  assert.deepEqual(fromBlog.features.map((feature) => feature.id).sort(), ["authors", "blog"]);
  assert.deepEqual(fromBlog.implied, ["authors"]);

  const fromAuthors = resolveSelection(["authors"]);

  assert.deepEqual(fromAuthors.features.map((feature) => feature.id).sort(), ["authors", "blog"]);
  assert.deepEqual(fromAuthors.implied, ["blog"]);
});

test("resolveSelection pulls in the section a feature owns", () => {
  const { features, implied } = resolveSelection(["contact-form"]);

  assert.deepEqual(features.map((feature) => feature.id).sort(), ["contact-form", "section:contact-form"]);
  assert.deepEqual(implied, ["section:contact-form"]);
});

test("resolveSelection reports ids that are not in the manifest instead of ignoring them", () => {
  const { features, unknown } = resolveSelection(["blog", "not-a-feature"]);

  assert.deepEqual(unknown, ["not-a-feature"]);
  assert.ok(features.some((feature) => feature.id === "blog"));
});

test("removing every feature at once leaves no two edits fighting over the same text", () => {
  const byFile = new Map<string, { edit: ReturnType<typeof describeEdit>; feature: string }[]>();

  for (const feature of present) {
    for (const { file, edits } of feature.edits) {
      const entries = byFile.get(file) ?? [];
      entries.push(...edits.map((edit) => ({ edit: describeEdit(edit), feature: feature.id })));
      byFile.set(file, entries);
    }
  }

  for (const [file, entries] of byFile) {
    const seen = new Map<string, string>();

    for (const { edit, feature } of entries) {
      const owner = seen.get(edit);

      assert.equal(owner, undefined, `${file}: "${edit}" is claimed by both ${owner} and ${feature}`);
      seen.set(edit, feature);
    }
  }
});

test("isFeaturePresent is false only once nothing a feature owns is left", () => {
  const feature = { paths: ["a.ts", "b.ts"] } as (typeof FEATURES)[number];

  assert.equal(
    isFeaturePresent(feature, () => true),
    true
  );
  assert.equal(
    isFeaturePresent(feature, (path) => path === "b.ts"),
    true
  );
  assert.equal(
    isFeaturePresent(feature, () => false),
    false
  );
});

test("every feature declares content for the same-run purge to delete", () => {
  // `--dataset` purges what the run just removed, using these lists. A feature that owns files but
  // names no type would silently leave its content behind.
  for (const feature of FEATURES) {
    const owns = (feature.documentTypes?.length ?? 0) + (feature.sectionTypes?.length ?? 0) + (feature.fields?.length ?? 0);

    assert.ok(
      owns > 0 || feature.codeOnly,
      `${feature.id} declares no documentTypes, sectionTypes or fields, so it can never be purged. Mark it \`codeOnly\` if that is the point.`
    );
  }
});

const STARTER_SECTIONS = FEATURES.filter((feature) => feature.id.startsWith("section:"));
const ON_DISK = STARTER_SECTIONS.flatMap(sectionNamesOf);

test("findSelectionConflicts refuses a selection that would empty the page-builder registry", () => {
  const conflicts = findSelectionConflicts(STARTER_SECTIONS, ON_DISK);

  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0] ?? "", /every page-builder section/);
});

test("findSelectionConflicts allows every smaller selection, including all but one section", () => {
  assert.deepEqual(findSelectionConflicts(STARTER_SECTIONS.slice(0, -1), ON_DISK), []);
  assert.deepEqual(findSelectionConflicts([], ON_DISK), []);
  assert.deepEqual(
    findSelectionConflicts(
      FEATURES.filter((feature) => !feature.id.startsWith("section:")),
      ON_DISK
    ),
    []
  );
});

test("findSelectionConflicts counts a project's own sections as the ones that remain", () => {
  assert.deepEqual(findSelectionConflicts(STARTER_SECTIONS, [...ON_DISK, "FaqSection"]), []);
});

test("findSelectionConflicts catches the whole-manifest selection, which includes every section", () => {
  assert.equal(findSelectionConflicts([...FEATURES], ON_DISK).length, 1);
});

test("every manifest landmark exists, so a relocated registry fails here rather than silently", () => {
  // The landmarks are what tells the dataset-only purge that this manifest still describes this
  // tree. If one moves, `isFeaturePresent` starts reporting live features as already removed, so
  // this has to fail loudly rather than let the auto-detect draw conclusions from a moved folder.
  assert.deepEqual(
    findMissingLandmarks((path) => existsSync(join(root, path))),
    []
  );
});

test("landmarks are the registries shared by more than one feature", () => {
  const landmarks = manifestLandmarks();

  assert.ok(landmarks.length > 0, "the manifest shares no file between features, so it has no landmarks");

  for (const file of landmarks) {
    const owners = FEATURES.filter((feature) => feature.edits.some((entry) => entry.file === file));

    assert.ok(owners.length > 1, `${file} is only edited by ${owners.length} feature and is not a landmark`);
  }
});

test("a tree with no schema registry is not treated as one where every feature was trimmed", () => {
  const missing = findMissingLandmarks((path) => path !== "sanity/schemas/index.ts");

  assert.deepEqual(missing, ["sanity/schemas/index.ts"]);
});

test("a doc is declared once, as a doc, so index links are pruned rather than the file just vanishing", () => {
  // `docs` also derives the bullets pointing at it, and a doc under `paths` keeps its feature present.
  for (const feature of FEATURES) {
    const both = (feature.docs ?? []).filter((doc) => feature.paths.includes(doc));

    assert.deepEqual(both, [], `${feature.id}: declared under both paths and docs: ${both.join(", ")}`);
  }
});

test("a file the manifest tolerates being absent is never a landmark", () => {
  // `trim.ts` refuses to run when one is missing, so a generated file would be a first-run false alarm.
  const byFile = new Map<string, boolean[]>();

  for (const feature of FEATURES) {
    for (const entry of feature.edits) {
      byFile.set(entry.file, [...(byFile.get(entry.file) ?? []), entry.optional === true]);
    }
  }

  const alwaysOptional = [...byFile].filter(([, flags]) => flags.every(Boolean)).map(([file]) => file);
  const wrong = manifestLandmarks().filter((file) => alwaysOptional.includes(file));

  assert.deepEqual(wrong, [], `optional everywhere, so not evidence of anything:\n  ${wrong.join("\n  ")}`);
});

/** Paths a doc invents to show a pattern, rather than naming a file that ships. */
const EXAMPLE_PATHS = [
  "src/components/Component.astro",
  "src/components/Name/Name.astro",
  "src/components/Name/NameElement.ts",
  "src/features/page-builder/sections/HeroSection.astro",
];

/** The repository's own prose: docs, its skills (not the vendored ones) and the top-level guides. */
function ownProse(): string[] {
  const vendored = Object.keys((JSON.parse(read("skills-lock.json")) as { skills?: Record<string, unknown> }).skills ?? {}).map(
    (name) => `.agents/skills/${name}/`
  );
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".md") && !vendored.some((prefix) => path.startsWith(prefix))) {
        found.push(path);
      }
    }
  };

  walk("docs");
  walk(".agents/skills");

  return [...found, "AGENTS.md", "README.md", "GETTING-STARTED.md"].filter(exists);
}

test("every code path the docs and skills name still exists", starterOnly, () => {
  // A section that grows a companion moves from a flat file into a folder, and the prose naming the
  // flat file keeps reading as fact. Placeholders (`...`, `<name>`, globs) are not paths, and a
  // trimmed feature's paths are the trim's mention report to list rather than this test's to fail.
  const trimmed = FEATURES.filter((feature) => !present.includes(feature)).flatMap((feature) => feature.paths);
  const isTrimmed = (path: string) => trimmed.some((owned) => path === owned || path.startsWith(`${owned}/`));
  const missing = ownProse().flatMap((file) =>
    [...read(file).matchAll(/`(src\/[^`\s]+)`/g)]
      .map((match) => (match[1] ?? "").replace(/[#:].*$/, "").replace(/\/$/, ""))
      .filter((path) => !/\.\.\.|…|[<>*{}[\]]/.test(path) && !EXAMPLE_PATHS.includes(path) && !isTrimmed(path))
      .filter((path) => ![path, `${path}.ts`, `${path}.astro`].some(exists))
      .map((path) => `${file}: ${path}`)
  );

  assert.deepEqual(missing, []);
});
