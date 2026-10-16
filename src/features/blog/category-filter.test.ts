import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestedCategorySlugs, selectedCategories, toggleCategoryHref } from "./category-filter";

const KNOWN = ["engineering", "design"];

describe("selectedCategories", () => {
  it("is empty when nothing is selected", () => {
    assert.deepEqual(selectedCategories(new URLSearchParams(""), KNOWN), []);
  });

  it("reads every repeated category parameter, in the canonical sorted order", () => {
    const params = new URLSearchParams("category=engineering&category=design");

    assert.deepEqual(selectedCategories(params, KNOWN), ["design", "engineering"]);
  });

  it("matches the slugs the query filters on, underscores and capitals included", () => {
    const params = new URLSearchParams("category=design_systems&category=UX");
    const requested = requestedCategorySlugs(params);

    assert.deepEqual(requested, ["UX", "design_systems"]);
    assert.deepEqual(selectedCategories(params, ["design_systems", "UX"]), requested);
  });

  it("selects no more categories than the query was given", () => {
    const params = new URLSearchParams();
    const known = Array.from({ length: 20 }, (_, index) => `slug-${String(index).padStart(2, "0")}`);

    for (const slug of known) {
      params.append("category", slug);
    }

    assert.deepEqual(selectedCategories(params, known), requestedCategorySlugs(params));
  });

  it("drops a slug that is not a known category, so a stale URL cannot filter on it", () => {
    const params = new URLSearchParams("category=engineering&category=deleted-category");

    assert.deepEqual(selectedCategories(params, KNOWN), ["engineering"]);
  });

  it("deduplicates and ignores blank values", () => {
    const params = new URLSearchParams("category=engineering&category=engineering&category=%20");

    assert.deepEqual(selectedCategories(params, KNOWN), ["engineering"]);
  });
});

describe("toggleCategoryHref", () => {
  it("adds an unselected category", () => {
    assert.equal(toggleCategoryHref("/blog", [], "engineering"), "/blog?category=engineering");
  });

  it("appends to an existing selection", () => {
    assert.equal(toggleCategoryHref("/blog", ["engineering"], "design"), "/blog?category=engineering&category=design");
  });

  it("removes a category that is already selected", () => {
    assert.equal(toggleCategoryHref("/blog", ["engineering", "design"], "engineering"), "/blog?category=design");
  });

  it("drops the query string entirely when the last category is removed", () => {
    assert.equal(toggleCategoryHref("/blog", ["engineering"], "engineering"), "/blog");
  });
});

describe("requestedCategorySlugs", () => {
  it("keeps valid slugs, deduped and sorted", () => {
    const params = new URLSearchParams("category=engineering&category=design&category=engineering&category= design ");
    assert.deepEqual(requestedCategorySlugs(params), ["design", "engineering"]);
  });

  it("drops values outside the slug charset or over the length cap", () => {
    const params = new URLSearchParams();

    for (const value of ["a b", "a/b", "../x", "x%00", "a.b", "", "a".repeat(65)]) {
      params.append("category", value);
    }

    assert.deepEqual(requestedCategorySlugs(params), []);
  });

  it("caps how many slugs reach the query and the cache key", () => {
    const params = new URLSearchParams();

    for (let index = 0; index < 5000; index++) {
      params.append("category", `slug-${index}`);
    }

    assert.equal(requestedCategorySlugs(params).length, 10);
  });
});
