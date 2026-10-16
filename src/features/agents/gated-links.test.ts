import assert from "node:assert/strict";
import { test } from "node:test";
import { dropGatedLinks } from "./gated-links";

const SITE_URL = "https://www.example.test";
const GATED = new Set(["/members", "/blog/embargoed"]);

const LLMS_TXT = `# Example

> A site.

## Pages

- [Home](https://www.example.test/): Start here
- [Members](https://www.example.test/members): Protected since generation
- [About](https://www.example.test/about)

## Articles

- [Embargoed](https://www.example.test/blog/embargoed): Now noIndex (2026-01-01)
- [Launch](https://www.example.test/blog/launch): Public (2026-01-02)
`;

test("list items linking a now-gated page are dropped, the rest of the file is kept verbatim", () => {
  assert.equal(
    dropGatedLinks(LLMS_TXT, GATED, SITE_URL),
    `# Example

> A site.

## Pages

- [Home](https://www.example.test/): Start here
- [About](https://www.example.test/about)

## Articles

- [Launch](https://www.example.test/blog/launch): Public (2026-01-02)
`
  );
});

test("every spelling of a gated page's URL is caught", () => {
  for (const href of [
    "/members",
    "/members/",
    "https://www.example.test/members/",
    "https://www.example.test/members?ref=llms",
    "https://www.example.test/members#top",
    "https://www.example.test/%6Dembers",
    "https://www.example.test//members",
    "https://www.example.test/x/../members",
    'https://www.example.test/members "Members"',
  ]) {
    assert.equal(dropGatedLinks(`- [M](${href})`, GATED, SITE_URL), "", href);
  }
});

test("prose keeps its words and loses only the gated link", () => {
  assert.equal(
    dropGatedLinks("See [the members area](/members) or [about us](/about).", GATED, SITE_URL),
    "See the members area or [about us](/about)."
  );
});

test("links off the site, fragments and mail links are never treated as gated", () => {
  const markdown = [
    "- [Elsewhere](https://other.example/members)",
    "- [Jump](#members)",
    "- [Mail](mailto:members@example.test)",
  ].join("\n");

  assert.equal(dropGatedLinks(markdown, GATED, SITE_URL), markdown);
});

test("nothing gated leaves the text untouched", () => {
  assert.equal(dropGatedLinks(LLMS_TXT, new Set(), SITE_URL), LLMS_TXT);
});

test("a title with brackets in it cannot hide a gated link", () => {
  assert.equal(dropGatedLinks("- [Members [beta]](https://www.example.test/members): Protected", GATED, SITE_URL), "");
  assert.equal(dropGatedLinks("Read [the guide [2026]](/members) first.", GATED, SITE_URL), "Read the guide [2026] first.");
  assert.equal(
    dropGatedLinks("- [Guide [2026]](https://www.example.test/about)", GATED, SITE_URL),
    "- [Guide [2026]](https://www.example.test/about)"
  );
});

test("a gated link is found by its destination, whatever brackets its text holds", () => {
  for (const item of [
    "- [Q3 plan]](https://www.example.test/members): board only",
    "- [Guide [[v2]]](https://www.example.test/members): nested",
    "- [Escaped \\] bracket](https://www.example.test/members)",
  ]) {
    assert.equal(dropGatedLinks(item, GATED, SITE_URL), "", item);
  }

  assert.equal(dropGatedLinks("Read [Q3 plan]](/members) now.", GATED, SITE_URL), "Read [Q3 plan]] now.");
});

test("a link split by a soft break is one link: its list item goes whole, prose keeps its words", () => {
  assert.equal(
    dropGatedLinks("- [a\nb](https://www.example.test/members)\n- [About](/about)", GATED, SITE_URL),
    "- [About](/about)"
  );
  assert.equal(
    dropGatedLinks("See [Read the\nmerger memo](https://www.example.test/members) now.\n\nNext.", GATED, SITE_URL),
    "See Read the\nmerger memo now.\n\nNext."
  );
});

test("the site's apex and www twin, either scheme, are the same site; another port is not", () => {
  for (const href of ["https://example.test/members", "http://www.example.test/members", "https://WWW.EXAMPLE.TEST/members"]) {
    assert.equal(dropGatedLinks(`- [M](${href})`, GATED, SITE_URL), "", href);
  }

  assert.equal(
    dropGatedLinks("- [M](https://www.example.test:8443/members)", GATED, SITE_URL),
    "- [M](https://www.example.test:8443/members)"
  );
});

test("a gated page named without link syntax is removed too", () => {
  assert.equal(dropGatedLinks("[m]: https://www.example.test/members\n\nText.", GATED, SITE_URL), "\nText.");
  assert.equal(
    dropGatedLinks("[m]: https://www.example.test/members\n[a]: https://www.example.test/about", GATED, SITE_URL),
    "[a]: https://www.example.test/about"
  );
  assert.equal(
    dropGatedLinks("Go to <https://www.example.test/members> or <https://www.example.test/about>.", GATED, SITE_URL),
    "Go to  or <https://www.example.test/about>."
  );
  assert.equal(dropGatedLinks("Visit https://example.test/members.", GATED, SITE_URL), "Visit .");
  assert.equal(dropGatedLinks("- https://www.example.test/members", GATED, SITE_URL), "");
});

test("an encoded parenthesis in a destination still matches the gated page", () => {
  assert.equal(dropGatedLinks("- [S](https://www.example.test/secret%281%29)", new Set(["/secret(1)"]), SITE_URL), "");
});

test("a raw URL with balanced parentheses is read whole, in a list item, in prose and written out", () => {
  const gated = new Set(["/secret(1)"]);

  assert.equal(dropGatedLinks("- [Secret](https://www.example.test/secret(1)): board only", gated, SITE_URL), "");
  assert.equal(dropGatedLinks('- [Secret](/secret(1) "Secret")', gated, SITE_URL), "");
  assert.equal(dropGatedLinks("See [Secret](https://www.example.test/secret(1)) now.", gated, SITE_URL), "See Secret now.");
  assert.equal(dropGatedLinks("Visit https://www.example.test/secret(1) today.", gated, SITE_URL), "Visit  today.");
  assert.equal(
    dropGatedLinks("- [Other](https://www.example.test/secret(2)): public", gated, SITE_URL),
    "- [Other](https://www.example.test/secret(2)): public"
  );
});

test("a reference definition is checked by its own destination, and only its own lines go", () => {
  assert.equal(dropGatedLinks("See [Members][m].\n\n[m]: /members", GATED, SITE_URL), "See [Members][m].\n");
  assert.equal(dropGatedLinks("[m]: <https://www.example.test/members>", GATED, SITE_URL), "");
  assert.equal(dropGatedLinks('[m]: /members\n  "Members only"\nNext paragraph.', GATED, SITE_URL), "Next paragraph.");
  assert.equal(dropGatedLinks("[m]:\n  /members\nNext paragraph.", GATED, SITE_URL), "Next paragraph.");
  assert.equal(
    dropGatedLinks("[m]: https://www.example.test/members\nLazy prose after a definition", GATED, SITE_URL),
    "Lazy prose after a definition"
  );
  assert.equal(dropGatedLinks("[a]: /about\nMore prose.", GATED, SITE_URL), "[a]: /about\nMore prose.");
});
