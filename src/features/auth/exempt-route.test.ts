import assert from "node:assert/strict";
import { test } from "node:test";
import { runExemptRoute } from "./exempt-route";

test("an exempt route's own answer passes through untouched", async () => {
  const answer = new Response("ok", { status: 201 });

  assert.equal(await runExemptRoute(async () => answer), answer);
});

test("an exempt route that throws gets a fixed 503 no cache keeps, never a Basic challenge", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const response = await runExemptRoute(async () => {
    throw new TypeError("fetch failed");
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("retry-after"), "10");
  assert.equal(response.headers.get("www-authenticate"), null);
  assert.ok((await response.text()).length > 0, "a body keeps the answer off Astro's error page reroute");
  assert.equal(logged.mock.callCount(), 1);
});
