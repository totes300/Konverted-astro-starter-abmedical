import assert from "node:assert/strict";
import { test } from "node:test";
import { pageToMarkdown } from "./markdown";

const BASE_URL = "https://www.example.test";

function linkedBlock(href: string) {
  return {
    _type: "block",
    children: [{ _type: "span", text: "click me", marks: ["k1"] }],
    markDefs: [{ _key: "k1", _type: "linkField", href }],
  };
}

test("a rich text link with a runnable or off-site-by-trick href renders as plain text", () => {
  for (const href of [
    "javascript:alert(1)",
    " JAVASCRIPT:x",
    "java\tscript:x",
    "//evil.example",
    "/\\evil.example",
    "data:text/html,x",
  ]) {
    const markdown = pageToMarkdown({ uri: "/about", title: "About", content: [linkedBlock(href)] }, BASE_URL);

    assert.match(markdown, /^click me$/m, JSON.stringify(href));
    assert.doesNotMatch(markdown, /javascript|evil|data:/i, JSON.stringify(href));
  }
});

test("a safe rich text link is absolutized against the site", () => {
  const markdown = pageToMarkdown({ uri: "/about", title: "About", content: [linkedBlock("/contact")] }, BASE_URL);

  assert.match(markdown, /^\[click me\]\(https:\/\/www\.example\.test\/contact\)$/m);
});

test("a section CTA with a runnable href is dropped", () => {
  const markdown = pageToMarkdown(
    { uri: "/about", title: "About", sections: [{ cta: { href: "data:text/html,x", text: "Open" } }] },
    BASE_URL
  );

  assert.doesNotMatch(markdown, /data:|Open/);
});

test("an article list entry with a runnable uri is dropped", () => {
  const markdown = pageToMarkdown(
    {
      uri: "/blog",
      title: "Blog",
      articles: [
        { uri: "javascript:alert(1)", title: "Evil" },
        { uri: "/blog/launch", title: "Launch" },
      ],
    },
    BASE_URL
  );

  assert.doesNotMatch(markdown, /Evil|javascript/);
  assert.match(markdown, /- \[Launch\]\(https:\/\/www\.example\.test\/blog\/launch\)/);
});

const SMUGGLED = [
  "https://ok.example/a)[pwn](javascript:alert(document.domain)",
  "mailto:a@ok.example)[pwn](javascript:alert(1)",
  "#top)[pwn](javascript:alert(1)",
  "https://ok.example/](javascript:alert(1))",
];

test("an allowed URL cannot close its link early and smuggle a second, runnable one in after it", () => {
  for (const href of SMUGGLED) {
    const markdown = pageToMarkdown(
      {
        uri: "/blog",
        title: "Blog",
        articles: [{ uri: href, title: "Launch" }],
        content: [linkedBlock(href), { _type: "mediaBlock", alt: "Inline", imageUrl: href }],
        sections: [{ cta: { href } }, { cta: { href, text: "Go" } }, { media: { alt: "Hero", imageUrl: href } }],
      },
      BASE_URL
    );

    assert.doesNotMatch(markdown, /\]\(\s*javascript:/i, JSON.stringify(href));
    assert.doesNotMatch(markdown, /\[pwn\]/, JSON.stringify(href));
  }
});

test("parentheses in a URL are encoded, so a balanced one still makes one working link", () => {
  const markdown = pageToMarkdown(
    { uri: "/about", title: "About", content: [linkedBlock("https://en.wikipedia.org/wiki/Foo_(bar)")] },
    BASE_URL
  );

  assert.match(markdown, /^\[click me\]\(https:\/\/en\.wikipedia\.org\/wiki\/Foo_%28bar%29\)$/m);
});

test("a soft break inside a linked span keeps the link on one line", () => {
  const block = linkedBlock("/memo");
  block.children[0].text = "Read the\nmerger memo";

  const markdown = pageToMarkdown({ uri: "/about", title: "About", content: [block] }, BASE_URL);

  assert.match(markdown, /^\[Read the merger memo\]\(https:\/\/www\.example\.test\/memo\)$/m);
});
