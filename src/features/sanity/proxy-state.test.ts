import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  createProxySanityState,
  STALE_GRACE_MS as GRACE_MS,
  type ProxySanityEnv,
  RETRY_BACKOFF_MS,
  STALE_IF_ERROR_MS,
  HOT_CACHE_TTL_MS as TTL_MS,
} from "./proxy-state";

const realFetch = globalThis.fetch;
const realDateNow = Date.now;
const realConsoleError = console.error;

let now = 1_000_000;
let fetchCalls: string[] = [];
let nextPayload: unknown = { ok: true };
let failNextFetch = false;
let failAllFetches = false;
let errorsLogged = 0;

const env: ProxySanityEnv = {
  projectId: "test-project",
  dataset: "test-dataset",
  apiVersion: "2024-01-01",
  token: "test-token",
};

type Payload = { value?: string | null };
type State = { value: string };

function toState(payload: Payload): State {
  return { value: payload.value ?? "missing" };
}

beforeEach(() => {
  now = 1_000_000;
  fetchCalls = [];
  nextPayload = { value: "first" };
  failNextFetch = false;
  failAllFetches = false;
  errorsLogged = 0;

  Date.now = () => now;
  console.error = () => {
    errorsLogged++;
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));

    if (failAllFetches) {
      throw new Error("network down");
    }

    if (failNextFetch) {
      failNextFetch = false;
      throw new Error("network down");
    }

    return new Response(JSON.stringify({ result: nextPayload }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realDateNow;
  console.error = realConsoleError;
});

/** Lets the background refresh promise settle. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("cold call fetches once and transforms the payload", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  const state = await getState();

  assert.deepEqual(state, { value: "first" });
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0] ?? "", /test-project\.api\.sanity\.io/);
  assert.match(fetchCalls[0] ?? "", /perspective=published/);
});

test("fresh cache serves repeat calls without fetching", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  now += TTL_MS - 1000;
  const state = await getState();

  assert.deepEqual(state, { value: "first" });
  assert.equal(fetchCalls.length, 1);
});

test("concurrent cold calls dedupe into one fetch", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  const [a, b, c] = await Promise.all([getState(), getState(), getState()]);

  assert.deepEqual(a, { value: "first" });
  assert.deepEqual(b, { value: "first" });
  assert.deepEqual(c, { value: "first" });
  assert.equal(fetchCalls.length, 1);
});

test("within the grace window, serves stale state and refreshes in the background", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  nextPayload = { value: "second" };
  now += TTL_MS + 1000;

  const stale = await getState();
  assert.deepEqual(stale, { value: "first" });

  await tick();
  const fresh = await getState();
  assert.deepEqual(fresh, { value: "second" });
  assert.equal(fetchCalls.length, 2);
});

test("past TTL + grace, blocks on a fresh fetch like a cold start", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  nextPayload = { value: "second" };
  now += TTL_MS + GRACE_MS + 1000;

  const state = await getState();

  assert.deepEqual(state, { value: "second" });
  assert.equal(fetchCalls.length, 2);
});

test("a failed background refresh degrades to last-known state instead of throwing", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  failNextFetch = true;
  now += TTL_MS + 1000;

  const stale = await getState();
  assert.deepEqual(stale, { value: "first" });

  // The rejected refresh must not surface later as an unhandled rejection.
  await tick();
  assert.equal(errorsLogged, 1, "a failed refresh is logged");

  // Recovery: past the retry backoff, the next call in the grace window starts a refresh that succeeds.
  nextPayload = { value: "recovered" };
  now += RETRY_BACKOFF_MS;
  await getState();
  await tick();
  assert.deepEqual(await getState(), { value: "recovered" });
});

test("past TTL + grace, a failed refresh serves last-known state (stale-if-error)", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  failAllFetches = true;
  now += TTL_MS + GRACE_MS + 1000;

  assert.deepEqual(await getState(), { value: "first" });
});

test("stale-if-error stops after its ceiling and the failure surfaces", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  failAllFetches = true;
  now += STALE_IF_ERROR_MS + 1000;

  await assert.rejects(getState, /network down/);
});

test("after a failure, refreshes back off instead of retrying per request", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await getState();
  failAllFetches = true;
  now += TTL_MS + GRACE_MS + 1000;

  await getState();
  await getState();
  await getState();
  assert.equal(fetchCalls.length, 2);

  now += RETRY_BACKOFF_MS;
  await getState();
  assert.equal(fetchCalls.length, 3);
});

test("a cold instance with a failing refresh rejects so the caller decides, and backs off too", async () => {
  failAllFetches = true;
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await assert.rejects(getState, /network down/);
  await assert.rejects(getState, /network down/);
  assert.equal(fetchCalls.length, 1);
});

test("non-ok response rejects on a cold start", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  const getState = createProxySanityState<Payload, State>("*[]", toState, env);

  await assert.rejects(getState, /Sanity middleware fetch failed: 500/);
});

test("missing Sanity env rejects with a named error", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, { ...env, token: undefined });

  await assert.rejects(getState, /Missing Sanity environment for middleware/);
});

test("a new content version forces a blocking refetch inside the TTL", async () => {
  let version = "v1";
  const getState = createProxySanityState<Payload, State>("*[]", toState, env, { version: async () => version });

  await getState();
  await getState();
  assert.equal(fetchCalls.length, 1, "the same version is served from memory");

  nextPayload = { value: "after publish" };
  version = "v2";
  now += 1000;

  assert.deepEqual(await getState(), { value: "after publish" }, "no stale serve after a publish");
  assert.equal(fetchCalls.length, 2);

  assert.deepEqual(await getState(), { value: "after publish" });
  assert.equal(fetchCalls.length, 2);
});

test("an unreadable content version falls back to the TTL", async () => {
  const getState = createProxySanityState<Payload, State>("*[]", toState, env, {
    version: async () => {
      throw new Error("store down");
    },
  });

  await getState();
  now += TTL_MS - 1000;
  await getState();

  assert.equal(fetchCalls.length, 1);
});

test("a publish that cannot be refetched keeps the last-known state within stale-if-error", async () => {
  let version = "v1";
  const getState = createProxySanityState<Payload, State>("*[]", toState, env, { version: async () => version });

  await getState();
  version = "v2";
  failAllFetches = true;

  assert.deepEqual(await getState(), { value: "first" });
});

/** Answers fetches in the order the test releases them, each with the payload it was given. */
function heldFetches() {
  const held: { release: (payload: Payload) => void }[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));

    const payload = await new Promise<Payload>((resolve) => {
      held.push({ release: resolve });
    });

    return new Response(JSON.stringify({ result: payload }), { status: 200 });
  }) as typeof fetch;

  return held;
}

test("a refresh started before a bump is not joined by a caller that read the new version", async () => {
  let version = "v1";
  const getState = createProxySanityState<Payload, State>("*[]", toState, env, { version: async () => version });
  const held = heldFetches();

  const beforeBump = getState();
  await tick();
  version = "v2";
  const afterBump = getState();
  await tick();

  assert.equal(fetchCalls.length, 2, "the caller under v2 starts its own fetch");

  held[0]?.release({ value: "before publish" });
  held[1]?.release({ value: "after publish" });

  assert.deepEqual(await beforeBump, { value: "before publish" });
  assert.deepEqual(await afterBump, { value: "after publish" });
});

test("a fetch that started before the held state's never replaces it, whichever settles last", async () => {
  let version = "v1";
  const getState = createProxySanityState<Payload, State>("*[]", toState, env, { version: async () => version });
  const held = heldFetches();

  const beforeBump = getState();
  await tick();
  version = "v2";
  const afterBump = getState();
  await tick();

  held[1]?.release({ value: "after publish" });
  assert.deepEqual(await afterBump, { value: "after publish" });

  held[0]?.release({ value: "before publish" });
  await beforeBump;
  await tick();

  assert.deepEqual(await getState(), { value: "after publish" });
  assert.equal(fetchCalls.length, 2);
});
