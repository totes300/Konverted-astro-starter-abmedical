import assert from "node:assert/strict";
import { test } from "node:test";
import { FEED_PATH } from "~/features/feed/constants";
import { isExcludedPath } from "./excluded-paths";

test("isExcludedPath skips the Studio route, with or without a trailing slash on its base path", () => {
  assert.equal(isExcludedPath("/studio/[...params]", "/studio"), true);
  assert.equal(isExcludedPath("/studio/[...params]", "/studio/"), true);
  assert.equal(isExcludedPath("/studios/[...params]", "/studio"), false);
});

test("isExcludedPath skips endpoint routes under /api and file routes", () => {
  for (const route of ["/api/contact-form", "/api/newsletter", "/api/agent-markdown/[...uri]"]) {
    assert.equal(isExcludedPath(route, "/studio"), true, route);
  }

  for (const route of ["/favicon.ico", "/robots.txt", "/sitemap.xml", "/llms.txt", "/openapi.json"]) {
    assert.equal(isExcludedPath(route, "/studio"), true, route);
  }
});

test("isExcludedPath gates every page route, the 404 route, component islands and the image endpoint", () => {
  for (const route of [
    "/[...uri]",
    "/blog/[slug]",
    "/blog/authors/[slug]/modal",
    "/section-preview/[section]",
    "/404",
    "/_server-islands/[name]",
    "/_image",
  ]) {
    assert.equal(isExcludedPath(route, "/studio"), false, route);
  }
});

test("isExcludedPath gates the feed despite its extension", () => {
  assert.equal(isExcludedPath(FEED_PATH, "/studio"), false);
});
