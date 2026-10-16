import assert from "node:assert/strict";
import { test } from "node:test";
import { pageToMarkdown } from "./markdown";
import { type AgentMarkdownSource, publishedDocumentId, withPublishedArticleLists } from "./published-article-lists";

const BASE_URL = "https://www.example.test";

// What the nested subquery returns under `raw` (drafts and versions are rows) and `drafts` (draft-only articles appear).
const LEAKED = [
  { uri: "/blog/draft-only", title: "Draft only" },
  { uri: "/blog/release-only", title: "Release only" },
  { uri: "/blog/published-one", title: "Published one" },
];

const PUBLISHED: AgentMarkdownSource = {
  _id: "blog",
  _type: "blog",
  articles: [{ uri: "/blog/published-one", title: "Published one" }],
};

test("publishedDocumentId strips draft and release version prefixes", () => {
  assert.equal(publishedDocumentId("blog"), "blog");
  assert.equal(publishedDocumentId("drafts.blog"), "blog");
  assert.equal(publishedDocumentId("versions.rAbC123.blog"), "blog");
});

test("drafts and versions of the listing never appear in its Markdown, whatever perspective read it", async () => {
  const requested: string[][] = [];
  const pages: AgentMarkdownSource[] = [
    { _id: "blog", _type: "blog", uri: "/blog", title: "Blog", articles: LEAKED },
    { _id: "drafts.blog", _type: "blog", uri: "/blog", title: "Blog", articles: LEAKED },
    { _id: "versions.rAbC123.blog", _type: "blog", uri: "/blog", title: "Blog", articles: LEAKED },
  ];

  const result = await withPublishedArticleLists(pages, async (ids) => {
    requested.push(ids);
    return [PUBLISHED];
  });

  assert.deepEqual(requested, [["blog"]]);

  for (const page of result) {
    const markdown = pageToMarkdown(page, BASE_URL);

    assert.match(markdown, /\[Published one\]\(https:\/\/www\.example\.test\/blog\/published-one\)/);
    assert.doesNotMatch(markdown, /draft-only|release-only/, page._id);
  }
});

test("a listing that was never published lists no articles", async () => {
  const [page] = await withPublishedArticleLists(
    [{ _id: "drafts.blog", _type: "blog", uri: "/blog", articles: LEAKED }],
    async () => []
  );

  assert.deepEqual(page?.articles, []);
});

test("pages without a listing are left alone and cost no read", async () => {
  const pages: AgentMarkdownSource[] = [{ _id: "drafts.about", _type: "page", uri: "/about", title: "About" }];
  let reads = 0;

  const result = await withPublishedArticleLists(pages, async () => {
    reads += 1;
    return [];
  });

  assert.equal(reads, 0);
  assert.equal(result, pages);
});
