import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeHrefProblem } from "./relative-href";

test("relative links on this site are accepted", () => {
  for (const href of ["?modal=contact", "/about?modal=contact", "/", "#team", "/about#team"]) {
    assert.equal(relativeHrefProblem(href), null, href);
  }
});

test("schemes, other sites and characters a browser rewrites are refused", () => {
  for (const href of [
    "javascript:alert(1)",
    " JAVASCRIPT:x",
    "java\tscript:x",
    "data:text/html,x",
    "https://example.org",
    "mailto:hi@example.org",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "?modal=contact\n",
    "about",
    "",
  ]) {
    assert.notEqual(relativeHrefProblem(href), null, JSON.stringify(href));
  }
});
