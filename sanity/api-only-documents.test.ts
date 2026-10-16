import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { API_ONLY_DOCUMENTS, type ApiOnlyDocumentType, apiOnlyDocumentId } from "./constants";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIPPED_DIRS = new Set(["node_modules", "dist", "backups", "seed"]);
// A deny-list, so a code or template extension this file has never heard of is still scanned.
const NOT_SOURCE =
  /\.(?:md|json|jsonc|ya?ml|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|riv|lottie|pdf|gz|tar|zip|txt|lock)$/i;
const SANITY_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
// Typed, so the tests still compile in a project that has trimmed every API-only type.
const TYPES = Object.values(API_ONLY_DOCUMENTS) as ApiOnlyDocumentType[];
const HAND_BUILT_ID = /`\$\{API_ONLY_DOCUMENTS\.\w+\}\./;
const API_ONLY_WRITE = /_type: API_ONLY_DOCUMENTS\.(\w+)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    // Dot entries are build caches, tool settings and secrets (`.env`), never source.
    if (entry.name.startsWith(".")) {
      return [];
    }

    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path);
    }

    return entry.isFile() && !NOT_SOURCE.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

const FILES = sourceFiles(ROOT)
  .filter((file) => !file.endsWith(join("sanity", "constants.ts")) && !file.endsWith(join("sanity", "types.ts")))
  .map((file) => ({ path: relative(ROOT, file), text: readFileSync(file, "utf8") }));

test("every API-only type gets a random dotted id that Sanity accepts", () => {
  for (const type of TYPES) {
    const id = apiOnlyDocumentId(type);

    assert.match(id, new RegExp(`^${type}\\.[0-9a-f-]{36}$`));
    assert.match(id, SANITY_ID);
    assert.notEqual(apiOnlyDocumentId(type), id);
  }
});

test("a deterministic key is kept, and a key that is not an opaque token is refused", () => {
  for (const type of TYPES) {
    assert.equal(apiOnlyDocumentId(type, "cs_test_a1B2c3"), `${type}.cs_test_a1B2c3`);
    assert.match(apiOnlyDocumentId(type, "x".repeat(127 - `${type}`.length)), SANITY_ID);

    for (const key of ["", "a.b", "drafts.x", "jane@example.com", "a b", "../x", "x".repeat(128 - `${type}`.length)]) {
      assert.throws(() => apiOnlyDocumentId(type, key), JSON.stringify(key));
    }
  }
});

test("no code builds an API-only id by hand", () => {
  assert.deepEqual(
    FILES.filter((file) => HAND_BUILT_ID.test(file.text)).map((file) => file.path),
    [],
    "Build API-only ids with apiOnlyDocumentId from sanity/constants.ts, so they stay dotted."
  );
});

test("every file that writes an API-only type sets its id through apiOnlyDocumentId", () => {
  const offenders = FILES.flatMap((file) =>
    [...file.text.matchAll(API_ONLY_WRITE)]
      .filter(([, name]) => !file.text.includes(`apiOnlyDocumentId(API_ONLY_DOCUMENTS.${name}`))
      .map(([, name]) => `${file.path} (${name})`)
  );

  assert.deepEqual(offenders, [], "Set `_id: apiOnlyDocumentId(API_ONLY_DOCUMENTS.<type>)` on every API-only write.");
});
