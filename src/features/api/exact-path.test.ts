import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isExactRoutePath } from "./exact-path";

const CONTACT_FORM = "/api/contact-form";
const DRAFT_MODE_ENABLE = "/api/draft-mode/enable";

test("isExactRoutePath: only the route's own spelling of the path", () => {
  const url = `https://example.com${CONTACT_FORM}`;

  assert.equal(isExactRoutePath(url, CONTACT_FORM), true);
  assert.equal(isExactRoutePath(`${url}?utm=1`, CONTACT_FORM), true);

  for (const path of [
    "/api/contact-form/",
    "/api/contact%2Dform",
    "/api/%63ontact-form",
    "/api/contact%252Dform",
    "/api//contact-form",
  ]) {
    assert.equal(isExactRoutePath(`https://example.com${path}`, CONTACT_FORM), false, path);
  }
});

test("isExactRoutePath: the spellings the URL parser resolves to the route pass, and each still ends in its last segment", () => {
  for (const path of ["/api/./contact-form", "/api/%2e/contact-form", "/api/x/%2e%2e/contact-form", "/api\\contact-form"]) {
    assert.equal(isExactRoutePath(`https://example.com${path}`, CONTACT_FORM), true, path);
    assert.ok(path.endsWith("contact-form"), path);
  }
});

test("isExactRoutePath: every preview handshake spelling that passes carries draft-mode and ends in enable", () => {
  const query = "?sanity-preview-secret=x";

  for (const path of [
    DRAFT_MODE_ENABLE,
    "/api/./draft-mode/enable",
    "/api/x/../draft-mode/enable",
    "/api/draft-mode/./enable",
    "/api/draft-mode\\enable",
  ]) {
    assert.equal(isExactRoutePath(`https://example.com${path}${query}`, DRAFT_MODE_ENABLE), true, path);
    assert.ok(path.includes("draft-mode") && path.endsWith("enable"), path);
  }

  for (const path of [
    "/api/draft-mode//enable",
    "/api//draft-mode/enable",
    "/api/draft%2Dmode/enable",
    "/api/draft-mode/%65nable",
    "/api/draft-mode/enable/",
    "/api/draft-mode/enable/.",
  ]) {
    assert.equal(isExactRoutePath(`https://example.com${path}${query}`, DRAFT_MODE_ENABLE), false, path);
  }
});

test("the preview handshake refuses another spelling with the bad-secret 401 before it spends a Sanity read", () => {
  const source = readFileSync(join(import.meta.dirname, "../../pages/api/draft-mode/enable.ts"), "utf8");
  const pathCheck = source.search(/if \(!isExactRoutePath\(request\.url, routePattern\)\) \{\s*return invalidSecret\(\);\s*\}/);

  assert.ok(pathCheck > -1, "enable.ts answers another spelling with invalidSecret()");
  assert.ok(pathCheck < source.indexOf("hasPreviewSecretShape(url"), "the path is checked before the secret's shape");
  assert.ok(pathCheck < source.indexOf("await validatePreviewUrl("), "the path is checked before the Sanity read");
});
