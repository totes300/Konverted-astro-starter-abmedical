import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { ClientError, ServerError } from "@sanity/client";
import { previewCheckFailed } from "./preview-check";

const SECRET = "preview-secret-value-123";
const QUERY_URL = `https://testproj.api.sanity.io/v1/data/query/production?query=*&%24secret=%22${SECRET}%22`;

function sanityAnswer(statusCode: number) {
  const response = { statusCode, headers: {}, body: "Sanity answered", url: QUERY_URL, method: "GET" };

  return statusCode >= 500 ? new ServerError(response) : new ClientError(response);
}

function loggedText(logged: { mock: { calls: { arguments: unknown[] }[] } }) {
  return inspect(
    logged.mock.calls.map((call) => call.arguments),
    { depth: 8 }
  );
}

test("a Sanity that cannot be asked gets a retryable, uncached 503 with fixed text and a log without the secret", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const response = previewCheckFailed(Object.assign(new Error(`connect ECONNREFUSED ${QUERY_URL}`), { code: "ECONNREFUSED" }));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "10");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    error: "Could not verify the preview secret.",
    code: "preview_unavailable",
    hint: "Sanity did not answer. Reopen the preview in a moment.",
  });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(loggedText(logged), /ECONNREFUSED/);
  assert.doesNotMatch(loggedText(logged), new RegExp(SECRET));
});

test("a Sanity that refuses the view token gets a 500 that names it, with no retry and no secret in the log", async (t) => {
  for (const status of [400, 401, 403, 404]) {
    const logged = t.mock.method(console, "error", () => {});
    const response = previewCheckFailed(sanityAnswer(status));

    assert.equal(response.status, 500, String(status));
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).code, "preview_misconfigured");
    assert.match(loggedText(logged), new RegExp(String(status)));
    assert.doesNotMatch(loggedText(logged), new RegExp(SECRET));
    logged.mock.restore();
  }
});

test("a Sanity 5xx, a rate limit or a timeout stays a retryable 503", async (t) => {
  t.mock.method(console, "error", () => {});

  for (const status of [408, 429, 500, 503]) {
    const response = previewCheckFailed(sanityAnswer(status));

    assert.equal(response.status, 503, String(status));
    assert.equal(response.headers.get("retry-after"), "10");
    assert.equal((await response.json()).code, "preview_unavailable");
  }
});

test("a thrown value that is not an error is still a 503 with a fixed log line", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const response = previewCheckFailed(SECRET);

  assert.equal(response.status, 503);
  assert.doesNotMatch(loggedText(logged), new RegExp(SECRET));
});
