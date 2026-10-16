import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { richTextToFeedHtml } from "./html";

const BASE = "https://example.com";

function linked(href: string) {
  return {
    _type: "block",
    style: "normal",
    markDefs: [{ _key: "l", _type: "linkField", href }],
    children: [{ _type: "span", text: "click", marks: ["l"] }],
  };
}

describe("richTextToFeedHtml: links", () => {
  it("renders a runnable or off-site-by-trick link mark as plain text", () => {
    for (const href of [
      "javascript:alert(1)",
      " JAVASCRIPT:x",
      "java\tscript:x",
      "//evil.example",
      "/\\evil.example",
      "data:text/html,x",
    ]) {
      assert.equal(richTextToFeedHtml([linked(href)], BASE), "<p>click</p>", JSON.stringify(href));
    }
  });

  it("renders a plain `link` mark as its text, the shape the feed's projection delivers, and never as an empty anchor", () => {
    const plainLink = (markDef: Record<string, unknown> = {}) => ({
      _type: "block",
      style: "normal",
      markDefs: [{ _key: "l", _type: "link", ...markDef }],
      children: [{ _type: "span", text: "click", marks: ["l"] }],
    });

    assert.equal(richTextToFeedHtml([plainLink()], BASE), "<p>click</p>");
    assert.equal(richTextToFeedHtml([plainLink({ href: "//evil.example" })], BASE), "<p>click</p>");
    assert.equal(richTextToFeedHtml([plainLink({ href: 42 })], BASE), "<p>click</p>");
  });

  it("checks a plain `link` mark's href like any link, should a projection ever carry one", () => {
    const withHref = {
      _type: "block",
      style: "normal",
      markDefs: [{ _key: "l", _type: "link", href: "/a" }],
      children: [{ _type: "span", text: "click", marks: ["l"] }],
    };

    assert.equal(richTextToFeedHtml([withHref], BASE), '<p><a href="https://example.com/a">click</a></p>');
  });

  it("renders a safe link mark as an absolute anchor", () => {
    assert.equal(richTextToFeedHtml([linked("/a")], BASE), '<p><a href="https://example.com/a">click</a></p>');
    assert.equal(richTextToFeedHtml([linked("tel:+1 555")], BASE), '<p><a href="tel:+1 555">click</a></p>');
  });

  it("escapes an href that tries to break out of the attribute", () => {
    assert.equal(
      richTextToFeedHtml([linked('https://x.org/"onmouseover="alert(1)')], BASE),
      '<p><a href="https://x.org/%22onmouseover=%22alert(1)">click</a></p>'
    );
  });
});
