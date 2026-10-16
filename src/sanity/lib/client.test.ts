// `sanity:client` only resolves inside Astro, so this reads the module rather than importing it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(import.meta.dirname, "client.ts"), "utf8");

test("the read client gives up after 10 s, so a stalled Sanity cannot hold a render to the 60 s function cap", () => {
  assert.match(source, /const READ_TIMEOUT_MS = 10_000;/);
  assert.match(source, /export const sanityClient = baseClient\.withConfig\(\{[^}]*\btimeout: READ_TIMEOUT_MS\b[^}]*\}\);/);
});

test("the write client derives from the base client, so the read timeout cannot cut a long upload short", () => {
  assert.match(source, /export const sanityEditClient = baseClient\.withConfig\(/);
});
