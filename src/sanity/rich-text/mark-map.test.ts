import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const renderer = readFileSync(join(import.meta.dirname, "SanityRichText.astro"), "utf8");
const library = join(dirname(createRequire(import.meta.url).resolve("astro-portabletext")), "..");
const defaultMark = readFileSync(join(library, "components", "Mark.astro"), "utf8");

test("every default mark that renders a link is replaced, so an API-written markDef never reaches an href unchecked", () => {
  const linkMarks = [...defaultMark.matchAll(/markTypeIs\("([^"]+)"\) \? \(\s*<a\b/g)].map(([, markType]) => markType);
  const markMap = renderer.match(/\bmark: \{([\s\S]*?)\n {2}\},/)?.[1] ?? "";
  const overridden = new Set([...markMap.matchAll(/^\s*"?([\w-]+)"?: /gm)].map(([, markType]) => markType));

  assert.ok(linkMarks.length > 0, "astro-portabletext's default Mark.astro changed shape; re-check which marks render an href");
  assert.deepEqual(
    linkMarks.filter((markType) => !overridden.has(markType)),
    [],
    "map these marks to Link in SanityRichText.astro, which runs safeHref()"
  );
});
