import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const SEED_PATH = new URL("../../seed/seed-dataset.tar.gz", import.meta.url);

/** Minimal ustar reader: the seed is a plain Sanity export, so names, sizes and regular files are all it needs. */
function readTar(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const field = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .split("\0")[0] ?? "";
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    offset += 512;
    if (type === "0" || type === "") {
      entries.set(name, archive.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

type SeedDocument = { _id: string; _type: string; [key: string]: unknown };

function loadSeed() {
  const entries = readTar(gunzipSync(readFileSync(SEED_PATH)));
  const dataPath = [...entries.keys()].find((name) => name.endsWith("/data.ndjson"));
  assert.ok(dataPath, "seed archive has no data.ndjson");
  const root = dataPath.slice(0, -"data.ndjson".length);
  const documents = entries
    .get(dataPath)
    ?.toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SeedDocument);
  return { entries, root, documents: documents ?? [] };
}

function collect(value: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collect(item, `${path}[${index}]`, visit);
    }
  } else if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    visit(node, path);
    for (const [key, child] of Object.entries(node)) {
      collect(child, path ? `${path}.${key}` : key, visit);
    }
  }
}

// The import fails outright on a strong reference to a document the export left out (a type missing from `--types`).
test("every strong reference in the seed points at a document the seed contains", () => {
  const { documents } = loadSeed();
  const ids = new Set(documents.map((doc) => doc._id));
  const dangling: string[] = [];

  for (const doc of documents) {
    collect(doc, "", (node, path) => {
      if (typeof node._ref === "string" && !node._weak && !ids.has(node._ref)) {
        dangling.push(`${doc._id} ${path} -> ${node._ref}`);
      }
    });
  }

  assert.deepEqual(dangling, []);
});

test("every asset the seed documents use is bundled in the archive", () => {
  const { entries, root, documents } = loadSeed();
  const missing: string[] = [];

  for (const doc of documents) {
    collect(doc, "", (node, path) => {
      if (typeof node._sanityAsset !== "string") {
        return;
      }
      const file = node._sanityAsset.replace(/^\w+@file:\/\/\.\//, "");
      if (!entries.has(root + file)) {
        missing.push(`${doc._id} ${path} -> ${file}`);
      }
    });
  }

  assert.deepEqual(missing, []);
});

// A hand repack on macOS adds AppleDouble `._` files and xattr headers: metadata every clone would ship.
test("the archive carries no macOS metadata", () => {
  const archive = gunzipSync(readFileSync(SEED_PATH));
  const appleDouble = [...readTar(archive).keys()].filter((name) => name.split("/").at(-1)?.startsWith("._"));

  assert.deepEqual(appleDouble, []);
  assert.equal(archive.includes("xattr.com.apple."), false, "extended attributes in a pax header");
});

/** Must match the `--types` list in docs/sanity/seed-dataset.md: anything else could carry a secret. */
const SEED_TYPE_ALLOWLIST = new Set([
  "page",
  "legalPage",
  "site",
  "siteSettings",
  "blog",
  "article",
  "articleCategory",
  "person",
  "sanity.imageAsset",
  "sanity.fileAsset",
]);

const SINGLETON_TYPES = new Set(["site", "siteSettings", "blog"]);

/** Never content: preview and share secrets, plugin config secrets, visitor submissions. */
const SECRET_TYPE = /^(sanity\.previewUrl|sanity\.secrets|mux\.|secrets\.|contactFormSubmission$)/;

const SECRET_KEY = /(token|secret|password|apikey|api_key|privatekey|signingkey)/i;

function seedProblems(documents: SeedDocument[]): string[] {
  const problems: string[] = [];
  const singletons = new Map<string, string[]>();

  for (const doc of documents) {
    if (SECRET_TYPE.test(doc._type) || SECRET_TYPE.test(doc._id)) {
      problems.push(`${doc._id}: secret-bearing ${doc._type}`);
    } else if (!SEED_TYPE_ALLOWLIST.has(doc._type)) {
      problems.push(`${doc._id}: type ${doc._type} is not in the seed allowlist`);
    }

    if (doc._id.includes(".")) {
      problems.push(`${doc._id}: dotted ids (drafts, release versions, hidden documents) never ship in the seed`);
    }

    if (SINGLETON_TYPES.has(doc._type)) {
      singletons.set(doc._type, [...(singletons.get(doc._type) ?? []), doc._id]);
    }

    collect(doc, "", (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        if (SECRET_KEY.test(key) && typeof value === "string" && value) {
          problems.push(`${doc._id} ${path ? `${path}.` : ""}${key}: looks like a secret`);
        }
      }
    });
  }

  for (const [type, ids] of singletons) {
    if (ids.length > 1 || ids[0] !== type) {
      problems.push(`${type}: singleton must be one document with _id "${type}", found ${ids.join(", ")}`);
    }
  }

  return problems;
}

test("the seed holds only allowlisted content types and no secret-bearing document", () => {
  assert.deepEqual(seedProblems(loadSeed().documents), []);
});

test("seedProblems flags every secret-bearing or unexpected document a full export would add", () => {
  const bad: SeedDocument[] = [
    { _id: "secret-1", _type: "sanity.previewUrlSecret", secret: "s3cr3t" },
    { _id: "share-1", _type: "sanity.previewUrlShareAccess" },
    { _id: "secrets.mux", _type: "sanity.secrets" },
    { _id: "secrets.namespace", _type: "pluginConfig" },
    { _id: "mux-config", _type: "mux.apiKey" },
    { _id: "submission-1", _type: "contactFormSubmission", email: "visitor@example.com" },
    { _id: "contactFormSubmission.abc", _type: "contactFormSubmission" },
    { _id: "drafts.about", _type: "page" },
    { _id: "versions.rABC.about", _type: "page" },
    { _id: "other", _type: "redirect" },
    { _id: "siteSettings-copy", _type: "siteSettings" },
    { _id: "about", _type: "page", embed: { apiKey: "sk-live-123" } },
  ];
  const problems = seedProblems(bad).join("\n");

  for (const id of ["secret-1", "share-1", "secrets.mux", "secrets.namespace", "mux-config", "submission-1"]) {
    assert.match(problems, new RegExp(`^${id.replace(".", "\\.")}: secret-bearing`, "m"));
  }

  assert.match(problems, /^drafts\.about: dotted ids/m);
  assert.match(problems, /^versions\.rABC\.about: dotted ids/m);
  assert.match(problems, /^contactFormSubmission\.abc: secret-bearing/m);
  assert.match(problems, /^contactFormSubmission\.abc: dotted ids/m);
  assert.match(problems, /^other: type redirect is not in the seed allowlist/m);
  assert.match(problems, /^siteSettings: singleton must be one document/m);
  assert.match(problems, /^about embed\.apiKey: looks like a secret/m);
  assert.match(problems, /^secret-1 secret: looks like a secret/m);
});
