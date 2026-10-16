import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRequestPath, canonicalUri, decodeRequestPath, isPageAliasSpelling } from "./canonical-path";

test("decodeRequestPath decodes the way the router does and collapses doubled slashes", () => {
  assert.equal(decodeRequestPath("/about"), "/about");
  assert.equal(decodeRequestPath("/about/"), "/about");
  assert.equal(decodeRequestPath("/"), "/");
  assert.equal(decodeRequestPath("//about"), "/about");
  assert.equal(decodeRequestPath("/blog//post/"), "/blog/post");
  assert.equal(decodeRequestPath("/ab%6fut"), "/about");
  assert.equal(decodeRequestPath("/ab%256fut"), "/about");
  assert.equal(decodeRequestPath("/%C3%BCber-uns"), "/über-uns");
});

test("decodeRequestPath refuses spellings the router and a gate could read as two paths", () => {
  for (const unsafe of [
    "/a%2Fb",
    "/%2F/x",
    "/a%252Fb",
    "/a%3Fb",
    "/a%25",
    "/a%",
    "/%E0%A4%A",
    "/a%5Cb",
    "/a/%2e%2e/b",
    "/a/%2E/b",
    "/%2e%2e",
    `/%${"25".repeat(13)}41`,
  ]) {
    assert.equal(decodeRequestPath(unsafe), null, unsafe);
  }
});

test("decodeRequestPath keeps dotted names that are not dot segments", () => {
  assert.equal(decodeRequestPath("/.well-known/security.txt"), "/.well-known/security.txt");
  assert.equal(decodeRequestPath("/a..b"), "/a..b");
});

test("canonicalUri gives a stored URI the shape request paths take", () => {
  assert.equal(canonicalUri("/about"), "/about");
  assert.equal(canonicalUri("about"), "/about");
  assert.equal(canonicalUri("/about/"), "/about");
  assert.equal(canonicalUri("/"), "/");
  assert.equal(canonicalUri("/über-uns".normalize("NFD")), "/über-uns");
});

test("canonicalRequestPath matches a Unicode URI however the request spells it", () => {
  const stored = canonicalUri("/über-uns");

  for (const spelling of [
    "/über-uns",
    "/%C3%BCber-uns",
    "/%c3%bcber-uns/",
    "/u%CC%88ber-uns",
    "//%C3%BCber-uns",
    "/%25C3%25BCber-uns",
  ]) {
    assert.equal(canonicalRequestPath(spelling), stored, spelling);
  }
});

test("canonicalRequestPath strips the file spellings the router strips for pages", () => {
  assert.equal(canonicalRequestPath("/secret.html"), "/secret");
  assert.equal(canonicalRequestPath("/blog/secret.html"), "/blog/secret");
  assert.equal(canonicalRequestPath("/index.html"), "/");
  assert.equal(canonicalRequestPath("/blog/index.html"), "/blog");
  assert.equal(canonicalRequestPath("/secret%2Ehtml"), "/secret");
  assert.equal(canonicalRequestPath("/%73ecret.html"), "/secret");
  assert.equal(canonicalRequestPath("/a%2Fb"), null);
});

test("isPageAliasSpelling flags .html, .htm and /index, encoded or not", () => {
  for (const alias of ["/x.html", "/blog/x.html", "/index.html", "/index", "/index/", "/x.HTM", "/x%2Ehtml", "/%78.html"]) {
    assert.equal(isPageAliasSpelling(alias), true, alias);
  }

  for (const page of ["/", "/about", "/blog/index-of-things", "/robots.txt", "/feed.xml"]) {
    assert.equal(isPageAliasSpelling(page), false, page);
  }
});
