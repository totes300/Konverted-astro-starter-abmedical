import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_FOUND_ROUTE } from "~/features/auth/request-gate";
import { toAgentMarkdownState } from "./markdown-eligibility";
import { notFoundMarkdown, notFoundRender, serveAgentMarkdown } from "./serve-agent-markdown";

const SITE_URL = "https://www.example.test";

const STATE = toAgentMarkdownState({
  siteLocked: false,
  routes: [
    { uri: "/about", excluded: false, gated: false },
    { uri: "/members", excluded: true, gated: true },
  ],
});

const STORED: Record<string, { enabled?: boolean | null; content?: string | null }> = {
  "/about": { content: "# About\n\n- [Members](https://www.example.test/members)\n- [Blog](https://www.example.test/blog)" },
  "/members": { content: "# Members only" },
};

function serve(uri: string, readState: () => Promise<typeof STATE> = async () => STATE) {
  const reads: string[] = [];
  const response = serveAgentMarkdown({
    uri,
    siteUrl: SITE_URL,
    readState,
    readStoredMarkdown: async (path) => {
      reads.push(path);
      return STORED[path];
    },
  });

  return { response, reads };
}

test("a protected page answers 404 before any content read, though its Markdown is stored", async () => {
  const { response, reads } = serve("/members");
  const res = await response;
  const body = await res.text();

  assert.equal(res.status, 404);
  assert.doesNotMatch(body, /Members only/);
  assert.match(body, /^# 404 Not Found/);
  assert.deepEqual(reads, []);
});

test("a URI missing from the allowlist answers 404 without reading Sanity", async () => {
  for (const uri of ["/random-1", "/%6Dembers", "//members", "/about/../members"]) {
    const { response, reads } = serve(uri);

    assert.equal((await response).status, 404, uri);
    assert.deepEqual(reads, [], uri);
  }
});

test("site-wide Basic Auth answers 404 for every page", async () => {
  const locked = toAgentMarkdownState({ siteLocked: true, routes: [{ uri: "/about", excluded: false, gated: false }] });
  const { response, reads } = serve("/about", async () => locked);

  assert.equal((await response).status, 404);
  assert.deepEqual(reads, []);
});

test("an unreadable eligibility state fails closed", async (t) => {
  t.mock.method(console, "error", () => {});

  const { response, reads } = serve("/about", async () => {
    throw new Error("Sanity down");
  });

  assert.equal((await response).status, 404);
  assert.deepEqual(reads, []);
});

test("an eligible page is served with links to gated pages dropped", async () => {
  const { response, reads } = serve("/about");
  const res = await response;

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("vary"), "Accept");
  assert.equal(await res.text(), "# About\n\n- [Blog](https://www.example.test/blog)\n");
  assert.deepEqual(reads, ["/about"]);
});

test("an eligible page whose Markdown is gone or switched off answers 404", async () => {
  const empty = serveAgentMarkdown({
    uri: "/about",
    siteUrl: SITE_URL,
    readState: async () => STATE,
    readStoredMarkdown: async () => ({ enabled: false, content: "# About" }),
  });

  assert.equal((await empty).status, 404);
});

test("an agent asking for an unknown path gets the recovery map as Markdown, not the HTML 404 page", async () => {
  const res = notFoundMarkdown(SITE_URL);

  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("vary"), "Accept");
  assert.match(await res.text(), /^# 404 Not Found[\s\S]*\(https:\/\/www\.example\.test\/llms\.txt\)/);
});

function notFoundPass(init: RequestInit, routePattern = NOT_FOUND_ROUTE) {
  let nextCalls = 0;
  const next = async () => {
    nextCalls += 1;

    return new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
  };
  const render = notFoundRender({ routePattern, request: new Request(`${SITE_URL}/missing`, init) }, SITE_URL, next);

  return { render, next, nextCalls: () => nextCalls };
}

test("an unknown path asked for as Markdown gets the 404 map without rendering the HTML 404 page", async () => {
  const { render, nextCalls } = notFoundPass({ headers: { accept: "text/markdown" } });

  assert.ok(render);

  const res = await render();

  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(res.headers.get("vary"), "Accept");
  assert.match(await res.text(), /^# 404 Not Found/);
  assert.equal(nextCalls(), 0);
});

test("a browser or a non-GET on the 404 route gets the HTML 404 page", () => {
  for (const init of [
    { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } },
    {},
    { method: "POST", headers: { accept: "text/markdown" } },
  ]) {
    const { render, next } = notFoundPass(init);

    assert.equal(render, next, JSON.stringify(init));
  }
});

test("only the 404 route takes the Markdown map; a page route falls through to the rewrite and the gate", () => {
  assert.equal(notFoundPass({ headers: { accept: "text/markdown" } }, "/[...uri]").render, null);
});
