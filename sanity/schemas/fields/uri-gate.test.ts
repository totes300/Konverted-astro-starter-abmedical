import assert from "node:assert/strict";
import { test } from "node:test";
import { uriGateProblem } from "./uri-gate";

test("ordinary page URIs pass", () => {
  for (const uri of ["/", "/about", "/blog/model-content-not-pages", "/legal/privacy-policy", "/api-docs", "/apiary", "about"]) {
    assert.equal(uriGateProblem(uri), null, uri);
  }
});

test("URIs another route shadows or the gate refuses are flagged", () => {
  for (const uri of [
    "/about.html",
    "/v1.2",
    "/report.pdf",
    "/data.json",
    "/secret.txt",
    "/api",
    "/api/secret",
    "api/secret",
    "/_internal",
    "/_framework/data/secret",
    "/_platform/insights",
    "_private",
    "/secr%65t",
    "javascript:alert(1)",
    "/a:b",
    "/about us",
    "/about\t",
    "/team\\private",
    "/a\u0001b",
    "/a\u007fb",
    "/index",
    "/index/",
  ]) {
    assert.notEqual(uriGateProblem(uri), null, uri);
  }
});

test("a backslash and a control character each get their own reason", () => {
  assert.match(uriGateProblem("/team\\private") ?? "", /backslash/);
  assert.match(uriGateProblem("/a\u0001b") ?? "", /control character/);
});

test("the /index and dot reasons claim only what holds on any host", () => {
  for (const uri of ["/index", "/index/"]) {
    const problem = uriGateProblem(uri) ?? "";

    assert.match(problem, /can be treated as the homepage/, uri);
    assert.doesNotMatch(problem, /never/, uri);
  }

  const dot = uriGateProblem("/about.html") ?? "";

  assert.match(dot, /a file or a 404 can answer instead of this page/);
  assert.match(dot, /on a host that serves file-like addresses before its checks, the page can skip Password protect/);
});
