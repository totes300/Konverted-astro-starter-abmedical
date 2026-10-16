import assert from "node:assert/strict";
import { test } from "node:test";
import { createContentVersion } from "~/lib/route-cache/content-version";
import { handleCachePurge, type PurgeSteps } from "./cache-purge";

const SECRET = "s".repeat(64);

function purge(authorization?: string): Request {
  const headers = new Headers();

  if (authorization !== undefined) {
    headers.set("authorization", authorization);
  }

  return new Request("https://example.com/api/cache-purge", { method: "POST", headers });
}

function recordingSteps(overrides: Partial<PurgeSteps> = {}) {
  const calls: string[] = [];

  const steps: PurgeSteps = {
    secret: SECRET,
    bumpContentVersion: async () => {
      calls.push("bump");
    },
    invalidateAll: async () => {
      calls.push("invalidate all");
    },
    ...overrides,
  };

  return { calls, steps };
}

test("the secret as a Bearer token bumps the content version, then empties the cache", async () => {
  const { calls, steps } = recordingSteps();

  const response = await handleCachePurge(purge(`Bearer ${SECRET}`), steps);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { purged: "all" });
  assert.deepEqual(calls, ["bump", "invalidate all"]);
});

test("a missing, wrong or differently framed secret answers 401 invalid_secret and purges nothing", async () => {
  for (const authorization of [
    undefined,
    "",
    "Bearer ",
    `Bearer ${SECRET.slice(0, -1)}`,
    `Bearer ${SECRET}x`,
    `Bearer ${SECRET.toUpperCase()}`,
    `Basic ${SECRET}`,
    `bearer ${SECRET}`,
    SECRET,
  ]) {
    const { calls, steps } = recordingSteps();
    const response = await handleCachePurge(purge(authorization), steps);
    const body = await response.json();

    assert.equal(response.status, 401, String(authorization));
    assert.equal(body.code, "invalid_secret", String(authorization));
    assert.equal(response.headers.get("cache-control"), "private, no-store", String(authorization));
    assert.deepEqual(calls, [], String(authorization));
  }
});

test("a bump the store loses answers a fixed 500 and empties nothing", async (t) => {
  t.mock.method(console, "error", () => {});
  const lostWrites = createContentVersion({ get: async () => null, set: async () => {} });
  const { calls, steps } = recordingSteps({ bumpContentVersion: () => lostWrites.bump() });

  const response = await handleCachePurge(purge(`Bearer ${SECRET}`), steps);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.code, "internal_error");
  assert.equal(body.error, "Cache purge failed.");
  assert.doesNotMatch(JSON.stringify(body), /did not keep/);
  assert.deepEqual(calls, []);
});

test("an invalidation that throws answers the same fixed 500 and never leaks the cause", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { steps } = recordingSteps({
    invalidateAll: async () => {
      throw new Error("store token sk_live_secret rejected");
    },
  });

  const response = await handleCachePurge(purge(`Bearer ${SECRET}`), steps);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.code, "internal_error");
  assert.doesNotMatch(JSON.stringify(body), /sk_live_secret/);
  assert.equal(logged.mock.callCount(), 1);
});
