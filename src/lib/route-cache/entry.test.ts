import assert from "node:assert/strict";
import { test } from "node:test";
import { ENTRY_MAX_BYTES, entryKey, entryTtl, toEntry, toResponse } from "./entry";

test("entryKey ignores query parameter order", () => {
  const key = entryKey(new URL("https://example.com/blog?category=b&category=a"));

  assert.ok(key);
  assert.equal(key, entryKey(new URL("https://example.com/blog?category=a&category=b")));
});

test("entryKey ignores tracking parameters but keeps the ones a route reads", () => {
  const bare = entryKey(new URL("https://example.com/blog"));

  assert.equal(entryKey(new URL("https://example.com/blog?utm_source=x&utm_campaign=y&fbclid=abc&ref=news")), bare);
  assert.equal(entryKey(new URL("https://example.com/about?utm_source=x")), entryKey(new URL("https://example.com/about")));
  assert.notEqual(entryKey(new URL("https://example.com/blog?category=engineering")), bare);
  assert.equal(
    entryKey(new URL("https://example.com/blog?category=engineering&gclid=123")),
    entryKey(new URL("https://example.com/blog?category=engineering"))
  );
});

test("entryKey separates paths and query values", () => {
  const base = entryKey(new URL("https://example.com/blog"));

  assert.notEqual(base, entryKey(new URL("https://example.com/blog/post")));
  assert.notEqual(
    entryKey(new URL("https://example.com/blog?category=a")),
    entryKey(new URL("https://example.com/blog?category=b"))
  );
});

test("entryKey refuses a parameter its route does not read, so no unread value mints an entry", () => {
  for (const url of [
    "https://example.com/?x=1",
    "https://example.com/blog?page=2",
    "https://example.com/blog?category=a&page=2",
    "https://example.com/about?category=a",
    "https://example.com/blog/post?category=a",
    "https://example.com/?Category=a",
  ]) {
    assert.equal(entryKey(new URL(url)), null, url);
  }

  assert.equal(entryKey(new URL("https://example.com/blog/?category=a&category=b")), "astro-route:/blog?category=a&category=b");
});

test("entryKey keys every spelling of a path the router renders the same way as one entry", () => {
  const about = entryKey(new URL("https://example.com/about"));

  for (const spelling of [
    "https://example.com//about",
    "https://example.com/ab%6fut",
    "https://example.com/about/",
    "https://other.com/about",
  ]) {
    assert.equal(entryKey(new URL(spelling)), about, spelling);
  }

  assert.equal(entryKey(new URL("https://example.com/%C3%BCber-uns")), entryKey(new URL("https://example.com/über-uns")));
});

test("entryKey keeps a file spelling apart from the page, since only the page renders", () => {
  assert.notEqual(entryKey(new URL("https://example.com/about.html")), entryKey(new URL("https://example.com/about")));
});

test("entryKey refuses paths the router and the gates could read differently", () => {
  for (const url of [
    "https://example.com/a%2Fb",
    "https://example.com/a%252Fb",
    "https://example.com/a%5Cb",
    "https://example.com/%E0%A4%A",
  ]) {
    assert.equal(entryKey(new URL(url)), null, url);
  }
});

test("entryKey dedupes and sorts query values, so their order or repetition cannot mint entries", () => {
  assert.equal(
    entryKey(new URL("https://example.com/blog?category=b&category=a&category=b")),
    entryKey(new URL("https://example.com/blog?category=a&category=b"))
  );
});

test("entryKey refuses to key an oversized query, which still renders but is never stored", () => {
  const many = Array.from({ length: 17 }, (_, index) => `category=c${index}`).join("&");

  assert.equal(entryKey(new URL(`https://example.com/blog?${many}`)), null);
  assert.equal(entryKey(new URL(`https://example.com/blog?category=${"a".repeat(101)}`)), null);
  assert.ok(entryKey(new URL(`https://example.com/blog?category=${"a".repeat(100)}`)));
});

test("entryTtl only stores a plain 200 the route asked to cache", () => {
  const ok = new Response("hi", { status: 200 });

  assert.equal(entryTtl(ok, { maxAge: 60 }), 60);
  assert.equal(entryTtl(ok, { maxAge: 0 }), null);
  assert.equal(entryTtl(ok, undefined), null);
  assert.equal(entryTtl(new Response("nope", { status: 404 }), { maxAge: 60 }), null);
  assert.equal(entryTtl(new Response("hi", { status: 200, headers: { "set-cookie": "a=1" } }), { maxAge: 60 }), null);
});

test("entryTtl refuses a response whose cookies Astro has not written into headers yet", () => {
  const withCookies = new Response("hi", { status: 200 });
  const withoutCookies = new Response("hi", { status: 200 });

  // The shape Astro attaches: `Astro.cookies` rides on the response and becomes Set-Cookie after the provider returns.
  Reflect.set(withCookies, Symbol.for("astro.cookies"), {
    *headers() {
      yield "session=1; Path=/";
    },
  });
  Reflect.set(withoutCookies, Symbol.for("astro.cookies"), {
    *headers() {},
  });

  assert.equal(entryTtl(withCookies, { maxAge: 60 }), null);
  assert.equal(entryTtl(withoutCookies, { maxAge: 60 }), 60);
});

test("an entry round-trips status, headers and bytes", async () => {
  const bytes = new Uint8Array([0, 159, 146, 150, 255]);
  const entry = await toEntry(
    new Response(bytes, { status: 200, headers: { "content-type": "image/x-icon", "x-astro-test": "1" } })
  );

  assert.ok(entry);

  const response = toResponse(entry);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-astro-test"), "1");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("toEntry drops Set-Cookie and oversized bodies", async () => {
  const entry = await toEntry(new Response("hi", { status: 200, headers: { "set-cookie": "a=1" } }));

  assert.ok(entry);
  assert.equal(new Headers(entry.headers).has("set-cookie"), false);

  assert.equal(await toEntry(new Response("x".repeat(ENTRY_MAX_BYTES + 1))), null);
});
