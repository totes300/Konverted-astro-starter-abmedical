import assert from "node:assert/strict";
import { test } from "node:test";
import { apiErrorResponse, internalErrorResponse, privateJson } from "./errors";

test("returns the status with a JSON body of error, code, and hint", async () => {
  const response = apiErrorResponse(400, { error: "Bad input.", code: "bad_input", hint: "Fix it." });

  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Bad input.", code: "bad_input", hint: "Fix it." });
});

test("hint stays optional", async () => {
  const response = apiErrorResponse(500, { error: "Boom.", code: "internal_error" });

  assert.deepEqual(await response.json(), { error: "Boom.", code: "internal_error" });
});

test("a success answer is private and uncacheable too, whatever the caller passed", async () => {
  const response = privateJson({ ok: true }, { status: 201, headers: { "cache-control": "public, max-age=3600", "x-a": "1" } });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-a"), "1");
  assert.deepEqual(await response.json(), { ok: true });
});

test("an internal error logs the cause and never echoes its message", async (t) => {
  const logged: unknown[] = [];
  t.mock.method(console, "error", (value: unknown) => logged.push(value));
  const cause = new Error("request to https://api.example/secret?token=abc failed");

  const response = internalErrorResponse(cause, { error: "Generation failed.", code: "internal_error" });
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.doesNotMatch(text, /token=abc|api\.example/);
  assert.deepEqual(JSON.parse(text), { error: "Generation failed.", code: "internal_error" });
  assert.deepEqual(logged, [cause]);
});

test("an internal error can answer another status with the same fixed text", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = internalErrorResponse(new Error("upstream detail"), { error: "Timed out.", code: "upstream_timeout" }, 504);

  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { error: "Timed out.", code: "upstream_timeout" });
});
