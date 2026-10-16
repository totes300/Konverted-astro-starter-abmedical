import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSitemap } from "./sitemap";

const LASTMOD = "2026-10-01T10:00:00Z";

test("a URI with & or < is escaped, so one entry cannot invalidate the whole sitemap", () => {
  const xml = renderSitemap([
    { loc: "https://example.com/q&a", lastmod: LASTMOD },
    { loc: "https://example.com/a<b>", lastmod: LASTMOD },
  ]);

  assert.match(xml, /<loc>https:\/\/example\.com\/q&amp;a<\/loc>/);
  assert.match(xml, /<loc>https:\/\/example\.com\/a&lt;b&gt;<\/loc>/);
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;)/, "no bare ampersand");
});

test("each entry carries its URL and lastmod, and nothing else", () => {
  assert.equal(
    renderSitemap([{ loc: "https://example.com/", lastmod: LASTMOD }]),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      "    <loc>https://example.com/</loc>",
      `    <lastmod>${LASTMOD}</lastmod>`,
      "  </url>",
      "</urlset>",
      "",
    ].join("\n")
  );
});

test("no entries is still a valid, empty urlset", () => {
  assert.match(renderSitemap([]), /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n\n<\/urlset>\n$/);
});
