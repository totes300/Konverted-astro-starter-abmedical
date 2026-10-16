import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteSafeHref, safeHref } from "./safe-href";

const BASE = "https://example.com";

const ATTACKS = [
  "javascript:alert(1)",
  " JAVASCRIPT:x",
  "JaVaScRiPt:alert(document.cookie)",
  "java\tscript:x",
  "java\nscript:x",
  "\u0001javascript:x",
  "javascript\u0000:x",
  "//evil.example",
  " //evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "/\t/evil.example",
  "data:text/html,x",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "blob:https://example.com/x",
  "about",
  "",
  "   ",
  null,
  undefined,
];

test("site-relative hrefs and allowed schemes pass through, trimmed", () => {
  assert.equal(safeHref("/about"), "/about");
  assert.equal(safeHref("/"), "/");
  assert.equal(safeHref("/about?modal=contact#team"), "/about?modal=contact#team");
  assert.equal(safeHref("/#contact"), "/#contact");
  assert.equal(safeHref("?modal=contact"), "?modal=contact");
  assert.equal(safeHref("#pricing"), "#pricing");
  assert.equal(safeHref(" https://other.org/a?b=1 "), "https://other.org/a?b=1");
  assert.equal(safeHref("http://other.org/"), "http://other.org/");
  assert.equal(safeHref("HTTPS://other.org/"), "HTTPS://other.org/");
  assert.equal(safeHref("mailto:hi@example.org"), "mailto:hi@example.org");
  assert.equal(safeHref("tel:+39 333 1234567"), "tel:+39 333 1234567");
});

test("runnable, protocol-relative and unknown hrefs are refused, however they are spelled", () => {
  for (const href of ATTACKS) {
    assert.equal(safeHref(href), null, JSON.stringify(href));
  }
});

test("absoluteSafeHref resolves site-relative hrefs against the site and keeps a fragment", () => {
  assert.equal(absoluteSafeHref("/about/team", BASE), "https://example.com/about/team");
  assert.equal(absoluteSafeHref("/", `${BASE}/`), "https://example.com/");
  assert.equal(absoluteSafeHref("/#contact", BASE), "https://example.com/#contact");
  assert.equal(absoluteSafeHref("?modal=contact", BASE), "https://example.com/?modal=contact");
  assert.equal(absoluteSafeHref("#section", BASE), "#section");
  assert.equal(absoluteSafeHref("https://other.org/a b", BASE), "https://other.org/a%20b");
  assert.equal(absoluteSafeHref("mailto:hi@example.org", BASE), "mailto:hi@example.org");
  assert.equal(absoluteSafeHref("tel:+39 333 1234567", BASE), "tel:+39 333 1234567");
});

test("absoluteSafeHref refuses what safeHref refuses", () => {
  for (const href of ATTACKS) {
    assert.equal(absoluteSafeHref(href, BASE), null, JSON.stringify(href));
  }
});
