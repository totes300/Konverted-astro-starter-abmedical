import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parse } from "groq-js";
import { LinkFn, link } from "./fragment";
import { safeHref } from "./safe-href";

const PAGE = { _id: "page-about", _type: "page", title: "About", uri: { current: "/about" } };

async function hrefOf(value: Record<string, unknown>): Promise<string> {
  const query = `${LinkFn} *[_id == "doc"][0]{ "link": ${link("link")} }.link.href`;
  const dataset = [PAGE, { _id: "doc", _type: "doc", link: value }];
  const result = await (await evaluate(parse(query), { dataset })).get();

  return result as string;
}

test("site-relative hrefs and allowed schemes survive the query", async () => {
  assert.equal(await hrefOf({ type: "internal", internal: { link: { _ref: PAGE._id } } }), "/about");
  assert.equal(await hrefOf({ type: "external", external: "/ok" }), "/ok");
  assert.equal(await hrefOf({ type: "external", external: "#a" }), "#a");
  assert.equal(await hrefOf({ type: "params", paramsHref: "?modal=x" }), "?modal=x");
  assert.equal(await hrefOf({ type: "external", external: "https://other.org/a" }), "https://other.org/a");
  assert.equal(await hrefOf({ type: "external", external: "HTTPS://other.org/" }), "HTTPS://other.org/");
  assert.equal(await hrefOf({ type: "email", email: "hi@example.org" }), "mailto:hi@example.org");
  assert.equal(await hrefOf({ type: "phone", phone: "+39 333 1234567" }), "tel:+39 333 1234567");
});

test("a runnable or off-site href stored by an API write leaves the query as an empty string", async () => {
  for (const href of [
    "javascript:alert(1)",
    " JAVASCRIPT:x",
    "JaVaScRiPt:alert(document.cookie)",
    "//evil.example",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "about",
  ]) {
    assert.equal(await hrefOf({ type: "external", external: href }), "", href);
    assert.equal(await hrefOf({ type: "params", paramsHref: href }), "", href);
  }
});

test("what the coarse query filter passes, safeHref still refuses at render", async () => {
  const href = await hrefOf({ type: "external", external: "/\\evil.example" });

  assert.equal(href, "/\\evil.example");
  assert.equal(safeHref(href), null);
});
