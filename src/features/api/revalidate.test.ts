import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSignatureHeader } from "@sanity/webhook";
import { createContentVersion } from "~/lib/route-cache/content-version";
import { CONTENT_LAKE_SETTLE_MS, handleRevalidateDelivery, type PublishSteps } from "./revalidate";
import { WEBHOOK_SIGNATURE_HEADER } from "./webhook-signature";

const SECRET = "s".repeat(64);
const BODY = JSON.stringify({ _id: "drafts.page.home", _type: "page", uri: "/" });

async function delivery(body = BODY, header?: string | null): Promise<Request> {
  const signature = header === undefined ? await encodeSignatureHeader(body, Date.now(), SECRET) : header;
  const headers = new Headers();

  if (signature !== null) {
    headers.set(WEBHOOK_SIGNATURE_HEADER, signature);
  }

  return new Request("https://example.com/api/revalidate", { method: "POST", body, headers });
}

function recordingSteps(overrides: Partial<PublishSteps> = {}) {
  const calls: string[] = [];

  const steps: PublishSteps = {
    secret: SECRET,
    settle: async () => {
      calls.push("settle");
    },
    bumpContentVersion: async () => {
      calls.push("bump");
    },
    invalidateTags: async (tags) => {
      calls.push(`invalidate ${tags.join(" ")}`);
    },
    ...overrides,
  };

  return { calls, steps };
}

test("the settle wait is three seconds", () => {
  assert.equal(CONTENT_LAKE_SETTLE_MS, 3000);
});

test("a signed publish settles, then bumps the content version, then invalidates its tags", async () => {
  const { calls, steps } = recordingSteps();

  const response = await handleRevalidateDelivery(await delivery(), steps);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, ["settle", "bump", "invalidate page doc:page.home /"]);
  assert.deepEqual((await response.json()).tags, ["page", "doc:page.home", "/"]);
});

test("the bump waits for the settle to finish", async () => {
  const { promise: settling, resolve: settleStarted } = Promise.withResolvers<() => void>();
  const { calls, steps } = recordingSteps({
    settle: () =>
      new Promise<void>((resolve) => {
        settleStarted(resolve);
      }),
  });

  const pending = handleRevalidateDelivery(await delivery(), steps);
  const finishSettle = await settling;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [], "nothing moves while Content Lake settles");

  finishSettle();
  assert.equal((await pending).status, 200);
  assert.deepEqual(calls, ["bump", "invalidate page doc:page.home /"]);
});

test("a bump the store loses still invalidates the tags, then answers 500 with fixed text so Sanity redelivers", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const lostWrites = createContentVersion({ get: async () => null, set: async () => {} });
  const { calls, steps } = recordingSteps({ bumpContentVersion: () => lostWrites.bump() });

  const response = await handleRevalidateDelivery(await delivery(), steps);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.code, "internal_error");
  assert.equal(body.error, "Revalidation failed.");
  assert.doesNotMatch(JSON.stringify(body), /did not keep/);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /did not keep/);
  assert.deepEqual(calls, ["settle", "invalidate page doc:page.home /"]);
});

test("an expiry that throws answers the same fixed 500 and never leaks the cause", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { calls, steps } = recordingSteps({
    invalidateTags: async () => {
      throw new Error("store token sk_live_secret rejected");
    },
  });

  const response = await handleRevalidateDelivery(await delivery(), steps);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.deepEqual(Object.keys(body).sort(), ["code", "error", "hint"]);
  assert.equal(body.code, "internal_error");
  assert.doesNotMatch(JSON.stringify(body), /sk_live_secret/);
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(calls, ["settle", "bump"]);
});

test("an unsigned, forged, altered or stale delivery never settles, bumps or invalidates", async () => {
  const signed = await encodeSignatureHeader(BODY, Date.now(), SECRET);
  const cases: [string, Request, string][] = [
    ["unsigned", await delivery(BODY, null), "stale_signature"],
    ["forged", await delivery(BODY, await encodeSignatureHeader(BODY, Date.now(), "f".repeat(64))), "invalid_signature"],
    ["altered", await delivery(BODY.replace("page.home", "page.other"), signed), "invalid_signature"],
    [
      "stale",
      await delivery(BODY, await encodeSignatureHeader(BODY, Date.now() - 2 * 60 * 60 * 1000, SECRET)),
      "stale_signature",
    ],
  ];

  for (const [name, request, code] of cases) {
    const { calls, steps } = recordingSteps();
    const response = await handleRevalidateDelivery(request, steps);

    assert.equal(response.status, 401, name);
    assert.equal((await response.json()).code, code, name);
    assert.deepEqual(calls, [], name);
  }
});

test("a signed but malformed payload answers 400 and moves nothing", async () => {
  for (const body of [
    "not json",
    "null",
    JSON.stringify({ _type: "page" }),
    JSON.stringify({ _id: "", _type: "page" }),
    JSON.stringify({ _id: "page.home", _type: "page", uri: 42 }),
    JSON.stringify({ _id: "page.home", _type: "page", uri: "" }),
    JSON.stringify({ _id: "page.home", _type: "page", uri: ["/a", "/b"] }),
  ]) {
    const { calls, steps } = recordingSteps();
    const response = await handleRevalidateDelivery(await delivery(body), steps);

    assert.equal(response.status, 400, body);
    assert.equal((await response.json()).code, "invalid_payload", body);
    assert.deepEqual(calls, [], body);
  }
});

test("a document without a URI busts only its type and id tags", async () => {
  for (const uri of [null, undefined]) {
    const { calls, steps } = recordingSteps();

    await handleRevalidateDelivery(await delivery(JSON.stringify({ _id: "site", _type: "site", uri })), steps);

    assert.deepEqual(calls.at(-1), "invalidate site doc:site", String(uri));
  }
});

test("only a leading drafts. prefix is stripped from the document tag", async () => {
  const { calls, steps } = recordingSteps();
  const body = JSON.stringify({ _id: "page.drafts.home", _type: "page" });

  await handleRevalidateDelivery(await delivery(body), steps);

  assert.deepEqual(calls.at(-1), "invalidate page doc:page.drafts.home");
});
