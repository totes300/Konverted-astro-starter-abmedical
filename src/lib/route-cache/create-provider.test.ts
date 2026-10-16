// Exercises the full provider flow the way Astro's pipeline drives it. The provider does no background
// work, so these tests are the contract for both a long-lived Node process and a serverless function.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { perspectiveCookieName } from "@sanity/preview-url-secret/constants";
import type { CacheOptions, CacheProvider } from "astro";
import { basicAuthorizationHeader } from "~/features/auth/basic-auth";
import { DRAFT_SESSION_COOKIE } from "~/features/auth/draft-session";
import { createContentVersion, createMemoryVersionStore, INITIAL_CONTENT_VERSION } from "./content-version";
import { createRouteCacheProvider, ROUTE_CACHE_ALL_TAG, type RouteCacheDeps } from "./create-provider";
import { createMemoryStore } from "./store";

const realDateNow = Date.now;

let now = 1_000_000;

/** Stands in for the content version, which the revalidate webhook bumps before it expires tags. */
let version = "v1";

beforeEach(() => {
  now = 1_000_000;
  version = "v1";
  Date.now = () => now;
});

afterEach(() => {
  Date.now = realDateNow;
});

const AUTH_HEADER = basicAuthorizationHeader("editor", "s3cret");

/** Stands in for the published Basic Auth state the provider consults before any public read or write. */
type Access = { protectedPaths: Set<string>; known: boolean };

function makeProvider(
  access: Access = { protectedPaths: new Set(), known: true },
  deps: Partial<RouteCacheDeps> = {}
): CacheProvider {
  return createRouteCacheProvider({
    store: createMemoryStore(),
    getExpectedAuthorization: () => AUTH_HEADER,
    isPublicPath: async (path) => access.known && !access.protectedPaths.has(path),
    contentVersion: { read: async () => version, readFresh: async () => version },
    ...deps,
  });
}

const PUBLIC: Access = { protectedPaths: new Set(), known: true };

type ServeInput = {
  provider: CacheProvider;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  /** A function renders the body inside the request, so it can read what the page's queries would. */
  body?: string | (() => Promise<string>);
  status?: number;
  responseHeaders?: Record<string, string>;
  options?: CacheOptions | false;
  renders?: { count: number };
  /** Stands in for `Astro.cookies` writes, which reach the headers only after the provider returns. */
  astroCookies?: string[];
  /** Runs inside the render, after its content is read. */
  duringRender?: () => Promise<void>;
};

/** Drives one request the way Astro's pipeline would, applying cache options against the same Request instance. */
async function serve({
  provider,
  url = "https://example.com/about",
  method = "GET",
  headers = {},
  body = "rendered",
  status = 200,
  responseHeaders = {},
  options = { maxAge: 60, tags: ["page", "doc:about"] },
  renders,
  astroCookies,
  duringRender,
}: ServeInput): Promise<Response> {
  const request = new Request(url, { method, headers });

  const next = async () => {
    if (renders) {
      renders.count++;
    }

    await duringRender?.();

    if (options !== false) {
      provider.setHeaders?.(options, request);
    }

    const response = new Response(typeof body === "string" ? body : await body(), { status, headers: responseHeaders });

    if (astroCookies) {
      Reflect.set(response, Symbol.for("astro.cookies"), {
        *headers() {
          yield* astroCookies;
        },
      });
    }

    return response;
  };

  const onRequest = provider.onRequest;

  assert.ok(onRequest);

  // Astro hands middleware a runtime logger; the provider never logs, so a silent one satisfies the contract.
  const logger = { info() {}, warn() {}, error() {} };

  return onRequest({ request, url: new URL(url), logger }, next);
}

test("caches out of the box: first request MISS renders, second is a HIT with the same body", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  const first = await serve({ provider, renders, body: "v1" });

  assert.equal(first.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await first.text(), "v1");

  const second = await serve({ provider, renders, body: "v2 (must not render)" });

  assert.equal(second.headers.get("X-Astro-Cache"), "HIT");
  assert.equal(await second.text(), "v1");
  assert.equal(renders.count, 1);
});

test("past the TTL the entry is gone and the next request renders fresh", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  await serve({ provider, renders, body: "old" });

  now += 61_000; // past maxAge

  const response = await serve({ provider, renders, body: "new" });

  assert.equal(response.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await response.text(), "new");
  assert.equal(renders.count, 2);
});

test("the webhook path: invalidating a tag or a path expires the entry", async () => {
  const provider = makeProvider();

  await serve({ provider, body: "v1", url: "https://example.com/about" });
  await serve({ provider, body: "v1", url: "https://example.com/blog/post", options: { maxAge: 60, tags: ["article"] } });

  await provider.invalidate({ tags: ["doc:about"] });
  await provider.invalidate({ path: "/blog/post" });

  const about = await serve({ provider, body: "v2", url: "https://example.com/about" });
  const post = await serve({ provider, body: "v2", url: "https://example.com/blog/post" });

  assert.equal(about.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(post.headers.get("X-Astro-Cache"), "MISS");
});

test("gated and public entries never mix", async () => {
  const provider = makeProvider();

  const gatedFirst = await serve({
    provider,
    body: "secret page",
    headers: { authorization: AUTH_HEADER ?? "" },
  });

  assert.equal(gatedFirst.headers.get("X-Astro-Cache"), "MISS");

  // Same URL without credentials must not receive the gated copy.
  const publicRequest = await serve({ provider, body: "public render" });

  assert.equal(publicRequest.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await publicRequest.text(), "public render");

  // The gated visitor gets their cached copy back.
  const gatedSecond = await serve({
    provider,
    body: "unused",
    headers: { authorization: AUTH_HEADER ?? "" },
  });

  assert.equal(gatedSecond.headers.get("X-Astro-Cache"), "HIT");
  assert.equal(await gatedSecond.text(), "secret page");
});

test("credentials that match nothing skip the cache entirely", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  const headers = { authorization: `Basic ${btoa("editor:wrong")}` };

  await serve({ provider, renders, headers });
  const second = await serve({ provider, renders, headers });

  assert.equal(second.headers.get("X-Astro-Cache"), null);
  assert.equal(renders.count, 2);
});

test("draft mode, Markdown negotiation and non-GET requests bypass the cache", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  await serve({ provider, renders, headers: { cookie: `${perspectiveCookieName}=drafts` } });
  await serve({ provider, renders, headers: { cookie: `${perspectiveCookieName}=drafts` } });
  await serve({ provider, renders, headers: { accept: "text/markdown" } });
  await serve({ provider, renders, method: "POST" });

  assert.equal(renders.count, 4);
});

test("responses that must not be stored are not stored", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  // Non-200, Set-Cookie, and no cache options each render again on the next request.
  await serve({ provider, renders, status: 404, url: "https://example.com/missing" });
  await serve({ provider, renders, status: 404, url: "https://example.com/missing" });

  await serve({ provider, renders, responseHeaders: { "set-cookie": "session=1" }, url: "https://example.com/personal" });
  await serve({ provider, renders, responseHeaders: { "set-cookie": "session=1" }, url: "https://example.com/personal" });

  await serve({ provider, renders, options: false, url: "https://example.com/uncached" });
  await serve({ provider, renders, options: false, url: "https://example.com/uncached" });

  assert.equal(renders.count, 6);
});

test("purging the all-entries tag empties the cache, public and gated alike", async () => {
  const provider = makeProvider();

  await serve({ provider, url: "https://example.com/about", body: "about" });
  await serve({ provider, url: "https://example.com/contact", body: "contact" });
  await serve({ provider, headers: { authorization: AUTH_HEADER ?? "" }, body: "gated" });

  // All three are warm.
  assert.equal((await serve({ provider, url: "https://example.com/about" })).headers.get("X-Astro-Cache"), "HIT");

  await provider.invalidate({ tags: [ROUTE_CACHE_ALL_TAG] });

  for (const url of ["https://example.com/about", "https://example.com/contact"]) {
    assert.equal((await serve({ provider, url })).headers.get("X-Astro-Cache"), "MISS");
  }

  const gated = await serve({ provider, headers: { authorization: AUTH_HEADER ?? "" } });

  assert.equal(gated.headers.get("X-Astro-Cache"), "MISS");
});

test("a public entry is never served or stored once the state protects its path", async () => {
  const access: Access = { protectedPaths: new Set(), known: true };
  const provider = makeProvider(access);
  const renders = { count: 0 };

  await serve({ provider, renders, body: "public copy" });
  assert.equal((await serve({ provider, renders })).headers.get("X-Astro-Cache"), "HIT");

  // Password protect turned on: the stale public copy must reach no one, and the middleware answers instead.
  access.protectedPaths.add("/about");

  const blocked = await serve({ provider, renders, body: "401 from the gate", status: 401 });

  assert.equal(blocked.headers.get("X-Astro-Cache"), null);
  assert.equal(await blocked.text(), "401 from the gate");

  const rendered = await serve({ provider, renders, body: "rendered while protected" });

  assert.equal(rendered.headers.get("X-Astro-Cache"), null, "a render under protection is not stored as public");
  assert.equal(renders.count, 3);
});

test("an unknown Basic Auth state stores and serves nothing public, while gated traffic still caches", async () => {
  const access: Access = { protectedPaths: new Set(), known: false };
  const provider = makeProvider(access);
  const renders = { count: 0 };

  await serve({ provider, renders });
  await serve({ provider, renders });
  assert.equal(renders.count, 2);

  await serve({ provider, renders, headers: { authorization: AUTH_HEADER ?? "" } });
  const gated = await serve({ provider, renders, headers: { authorization: AUTH_HEADER ?? "" } });

  assert.equal(gated.headers.get("X-Astro-Cache"), "HIT");
});

test("the state is checked on the canonical page path, so a Unicode or file spelling cannot dodge it", async () => {
  const access: Access = { protectedPaths: new Set(["/über-uns", "/secret", "/"]), known: true };
  const provider = makeProvider(access);
  const renders = { count: 0 };

  for (const url of [
    "https://example.com/%C3%BCber-uns",
    "https://example.com/u%CC%88ber-uns",
    "https://example.com/secret.html",
    "https://example.com/index.html",
  ]) {
    await serve({ provider, renders, url });
    await serve({ provider, renders, url });
  }

  assert.equal(renders.count, 8);
});

test("a draft session cookie alone skips the store, even when the page re-enables caching", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };
  const headers = { cookie: `${DRAFT_SESSION_COOKIE}=1700000000.signature` };

  // `options` stands in for the page's own `cache.set`, which would undo the middleware's `cache.set(false)`.
  await serve({ provider, renders, headers, body: "draft render" });

  const anonymous = await serve({ provider, renders, body: "published render" });

  assert.equal(anonymous.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await anonymous.text(), "published render");
});

test("cookies set through Astro are never stored, though they are not headers yet", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  await serve({ provider, renders, astroCookies: ["session=1; Path=/"] });
  const second = await serve({ provider, renders, astroCookies: ["session=1; Path=/"] });

  assert.equal(second.headers.get("X-Astro-Cache"), null);
  assert.equal(renders.count, 2);
});

test("spellings the router renders as one page share its entry; a file spelling or a bad path never reads it", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  await serve({ provider, renders, body: "about" });

  for (const url of [
    "https://example.com//about",
    "https://example.com/ab%6fut",
    "https://example.com/about/",
    "https://example.com/about?utm_source=x",
  ]) {
    const hit = await serve({ provider, renders, url });

    assert.equal(hit.headers.get("X-Astro-Cache"), "HIT", url);
    assert.equal(await hit.text(), "about", url);
  }

  const html = await serve({ provider, renders, url: "https://example.com/about.html", status: 404, body: "not found" });

  assert.equal(await html.text(), "not found");

  const encoded = await serve({ provider, renders, url: "https://example.com/about%2Fx", body: "bad request", status: 400 });

  assert.equal(await encoded.text(), "bad request");
  assert.equal(renders.count, 3);
});

test("random query values each render, but an oversized query is never stored", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };
  const many = Array.from({ length: 17 }, (_, index) => `p${index}=1`).join("&");

  await serve({ provider, renders, url: `https://example.com/?${many}` });
  await serve({ provider, renders, url: `https://example.com/?${many}` });

  assert.equal(renders.count, 2);
});

test("invalidating a path reaches the entry stored from an encoded spelling of it", async () => {
  const provider = makeProvider();

  await serve({ provider, url: "https://example.com/%C3%BCber-uns" });
  await provider.invalidate({ path: "/über-uns" });

  const after = await serve({ provider, url: "https://example.com/über-uns" });

  assert.equal(after.headers.get("X-Astro-Cache"), "MISS");
});

test("a render that straddles a publish is not stored, so the purge it missed cannot leave its HTML behind", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  const straddled = await serve({
    provider,
    renders,
    body: "pre-publish",
    duringRender: async () => {
      version = "v2";
      await provider.invalidate({ tags: ["doc:about"] });
    },
  });

  assert.equal(straddled.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await straddled.text(), "pre-publish");

  const after = await serve({ provider, renders, body: "post-publish" });

  assert.equal(after.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await after.text(), "post-publish");
  assert.equal(renders.count, 2);
});

test("a publish that purges before the write lands is caught after the write, and the entry is deleted", async () => {
  const store = createMemoryStore();
  let publishBeforeWrite = true;
  const provider = makeProvider(PUBLIC, {
    store: {
      ...store,
      async set(key, entry, options) {
        if (publishBeforeWrite) {
          publishBeforeWrite = false;
          version = "v2";
          await store.expireTag(["doc:about"]);
        }

        await store.set(key, entry, options);
      },
    },
  });
  const renders = { count: 0 };

  await serve({ provider, renders, body: "pre-publish" });

  const after = await serve({ provider, renders, body: "post-publish" });

  assert.equal(after.headers.get("X-Astro-Cache"), "MISS");
  assert.equal(await after.text(), "post-publish");
  assert.equal((await serve({ provider, renders })).headers.get("X-Astro-Cache"), "HIT", "a render under one version is stored");
});

test("an unreadable content version stores nothing, since a straddled render could not be told apart", async () => {
  const down = async (): Promise<string> => {
    throw new Error("version store down");
  };
  const provider = makeProvider(PUBLIC, { contentVersion: { read: down, readFresh: down } });
  const renders = { count: 0 };

  await serve({ provider, renders });
  const second = await serve({ provider, renders });

  assert.equal(second.headers.get("X-Astro-Cache"), null);
  assert.equal(renders.count, 2);
});

test("a version read in flight across a publish never lets a pre-publish render be stored", async () => {
  const inner = createMemoryVersionStore();
  let releaseHeldRead: (() => void) | undefined;
  let reads = 0;
  const contentVersion = createContentVersion({
    async get() {
      reads += 1;

      const value = await inner.get();

      // Holds the first read in flight with the pre-publish value, the way a slow store read would.
      if (reads === 1) {
        await new Promise<void>((resolve) => {
          releaseHeldRead = resolve;
        });
      }

      return value;
    },
    set: inner.set,
  });
  const provider = makeProvider(PUBLIC, { contentVersion });
  const render = async () => ((await contentVersion.read()) === INITIAL_CONTENT_VERSION ? "pre-publish" : "post-publish");

  // Another request's read, started before the publish and still in flight across it.
  const heldRead = contentVersion.read();

  await contentVersion.bump();
  await provider.invalidate({ tags: ["doc:about"] });

  const straddled = serve({ provider, body: render });

  await new Promise((resolve) => setImmediate(resolve));
  releaseHeldRead?.();

  assert.equal(await heldRead, INITIAL_CONTENT_VERSION);
  await straddled;

  const after = await serve({ provider, body: render });

  assert.equal(await after.text(), "post-publish");
});

test("only the parameters a route reads key an entry; any other renders but is never stored", async () => {
  const provider = makeProvider();
  const renders = { count: 0 };

  for (const url of ["https://example.com/?x=1", "https://example.com/blog?page=2", "https://example.com/about?q=a"]) {
    await serve({ provider, renders, url });
    await serve({ provider, renders, url });
  }

  assert.equal(renders.count, 6);

  await serve({ provider, renders, url: "https://example.com/blog?category=a&category=b" });
  const filtered = await serve({ provider, renders, url: "https://example.com/blog?category=b&category=a&utm_source=x" });

  assert.equal(filtered.headers.get("X-Astro-Cache"), "HIT");
});
