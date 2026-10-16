// The route patterns are the ones Astro matches for each request (`context.routePattern`): a file spelling
// of a page still routes to the page, which is why exemption is decided by route and not by spelling.

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRequest, NOT_FOUND_ROUTE, requestPathname } from "./request-gate";

const STUDIO = "/studio";

function classify(routePattern: string, pathname: string) {
  return classifyRequest({ routePattern, pathname, studioBasePath: STUDIO });
}

test("a file spelling of a page is a 404, encoded or not, and never exempt", () => {
  for (const [route, pathname] of [
    ["/[...uri]", "/x.html"],
    ["/[...uri]", "/secret.html"],
    ["/blog/[slug]", "/blog/x.html"],
    ["/[...uri]", "/index.html"],
    ["/[...uri]", "/index"],
    ["/[...uri]", "/%78.html"],
    ["/[...uri]", "/x%2Ehtml"],
    ["/blog/[slug]", "/blog/%78.html"],
    ["/[...uri]", "/x.htm"],
  ] as const) {
    assert.deepEqual(classify(route, pathname), { kind: "not-found" }, pathname);
  }
});

test("the 404 page render of such a spelling is gated as the page it names", () => {
  assert.deepEqual(classify(NOT_FOUND_ROUTE, "/x.html"), { kind: "page", path: "/x" });
  assert.deepEqual(classify(NOT_FOUND_ROUTE, "/index.html"), { kind: "page", path: "/" });
  assert.deepEqual(classify(NOT_FOUND_ROUTE, "/api/no-handler"), { kind: "page", path: "/api/no-handler" });
  assert.deepEqual(classify(NOT_FOUND_ROUTE, "/unknown.txt"), { kind: "page", path: "/unknown.txt" });
});

test("an unknown dotted path is gated like any page, not skipped for its extension", () => {
  assert.deepEqual(classify("/[...uri]", "/secret.txt"), { kind: "page", path: "/secret.txt" });
  assert.deepEqual(classify("/[...uri]", "/sitemap.xml/"), { kind: "page", path: "/sitemap.xml" });
});

test("named endpoint routes, the API and the Studio are exempt", () => {
  for (const [route, pathname] of [
    ["/robots.txt", "/robots.txt"],
    ["/sitemap.xml", "/sitemap.xml"],
    ["/favicon.ico", "/favicon.ico"],
    ["/api/contact-form", "/api/contact-form"],
    ["/studio/[...params]", "/studio/structure"],
  ] as const) {
    assert.deepEqual(classify(route, pathname), { kind: "exempt" }, route);
  }
});

test("Astro's image endpoint answers 404 under any query, so it cannot re-serve a page under a chosen type", () => {
  for (const url of ["https://x.test/_image", "https://x.test/_image?href=/secret&f=html", "https://x.test/_image/"]) {
    assert.deepEqual(classify("/_image", requestPathname(new Request(url))), { kind: "not-found" }, url);
  }
});

test("a Studio-looking request path on a page route is not exempt", () => {
  assert.deepEqual(classify("/[...uri]", "/studio"), { kind: "page", path: "/studio" });
});

test("every spelling of a Unicode page gates as its stored URI", () => {
  for (const pathname of ["/über-uns", "/%C3%BCber-uns", "/u%CC%88ber-uns", "//%C3%BCber-uns/"]) {
    assert.deepEqual(classify("/[...uri]", pathname), { kind: "page", path: "/über-uns" }, pathname);
  }
});

test("a path the router and the gate could read differently is a 400", () => {
  for (const pathname of ["/a%2Fb", "/%2F/x", "/a%252Fb", "/a%25", "/%E0%A4%A", "/a%5Cb", "/team%5Cprivate"]) {
    assert.deepEqual(classify("/[...uri]", pathname), { kind: "bad-request" }, pathname);
  }
});

test("the gate reads the path as requested, not Astro's normalized URL, so %5C cannot gate as another page", () => {
  const request = new Request("https://x.test/team%5Cprivate");

  // What `context.url.pathname` holds: Astro decodes the path and the pathname setter turns the `\` into `/`.
  const normalized = new URL(request.url);
  normalized.pathname = decodeURI(normalized.pathname);

  assert.equal(normalized.pathname, "/team/private");
  assert.equal(decodeURI(requestPathname(request)), "/team\\private", "the router renders the page stored as team\\private");
  assert.equal(requestPathname(request), new URL("https://x.test/team%5Cprivate").pathname);
  assert.deepEqual(classify("/[...uri]", requestPathname(request)), { kind: "bad-request" });
  assert.deepEqual(classify("/[...uri]", normalized.pathname), { kind: "page", path: "/team/private" }, "the bypass this closes");
});

test("the section preview is caught under every spelling", () => {
  for (const pathname of [
    "/section-preview/hero",
    "/section-preview/hero.html",
    "/section-preview/%68ero",
    "//section-preview/hero",
  ]) {
    assert.deepEqual(classify("/section-preview/[section]", pathname), { kind: "section-preview" }, pathname);
  }
});
