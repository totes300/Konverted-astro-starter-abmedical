import assert from "node:assert/strict";
import { test } from "node:test";
import { isCacheableCategoryView, knownCategorySlugs } from "./category-view";

const KNOWN = ["design", "engineering"];

function cacheable(query: string): boolean {
  return isCacheableCategoryView(new URL(`https://example.com/blog${query}`).searchParams, KNOWN);
}

test("the unfiltered index and any selection of known categories are stored", () => {
  for (const query of ["", "?category=design", "?category=engineering&category=design", "?category=design&utm_source=x"]) {
    assert.equal(cacheable(query), true, query);
  }
});

test("a slug that is not a known category is never stored, so random slugs cannot mint entries", () => {
  for (const query of [
    "?category=made-up",
    "?category=design&category=made-up",
    `?category=${"a".repeat(64)}`,
    "?category=Design",
    "?category=%20design",
    "?category=",
  ]) {
    assert.equal(cacheable(query), false, query);
  }
});

test("a repeated or over-long selection is not stored, though the same view is under its canonical URL", () => {
  assert.equal(cacheable("?category=design&category=design"), false);

  const eleven = Array.from({ length: 11 }, (_, index) => `c${index}`);
  const params = new URLSearchParams(eleven.map((slug) => ["category", slug]));

  assert.equal(isCacheableCategoryView(params, eleven), false);
});

test("known slugs drop a category without one", () => {
  assert.deepEqual(knownCategorySlugs([{ slug: "design" }, { slug: null }, { slug: "" }]), ["design"]);
  assert.deepEqual(knownCategorySlugs(null), []);
});
