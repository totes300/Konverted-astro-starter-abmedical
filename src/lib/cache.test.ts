import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CacheOptions } from "astro";
import { CACHE_TTL, cacheResponse } from "./cache";

function recorder() {
  const calls: (CacheOptions | false)[] = [];

  return { calls, cache: { set: (input: CacheOptions | false) => calls.push(input) } };
}

test("cacheResponse caches a public render with the options it is given", () => {
  const { calls, cache } = recorder();

  cacheResponse({ cache, locals: {} }, { ...CACHE_TTL, tags: ["page"] });

  assert.deepEqual(calls, [{ ...CACHE_TTL, tags: ["page"] }]);
});

test("cacheResponse lets a route decline to cache a render", () => {
  const { calls, cache } = recorder();

  cacheResponse({ cache, locals: {} }, false);

  assert.deepEqual(calls, [false]);
});

test("cacheResponse never caches a draft session render, whatever the route asks", () => {
  const { calls, cache } = recorder();

  cacheResponse({ cache, locals: { draftSession: true } }, { ...CACHE_TTL, tags: ["page"] });

  assert.deepEqual(calls, [false]);
});

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return routeFiles(path);
    }

    return /\.(astro|ts)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("no page or endpoint sets its cache directly, so none can undo the draft session opt-out", () => {
  const pages = join(import.meta.dirname, "..", "pages");
  const files = routeFiles(pages);
  const direct = files.filter((file) => /\bcache\.set\(/.test(readFileSync(file, "utf8")));

  assert.ok(
    files.some((file) => file.endsWith(".ts")),
    "the scan reaches the endpoints"
  );
  assert.deepEqual(direct, []);
});
