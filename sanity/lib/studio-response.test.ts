import assert from "node:assert/strict";
import { test } from "node:test";
import { readStudioJson, studioFailure } from "./studio-response";

const TIMEOUT_PAGE = "504 Gateway Timeout";

test("a plain-text 504 reads as no payload and a timeout reason", async () => {
  const res = new Response(TIMEOUT_PAGE, { status: 504, headers: { "content-type": "text/plain" } });
  const payload = await readStudioJson<{ error?: string }>(res);

  assert.equal(payload, null);
  assert.equal(studioFailure(res, payload, "Screenshot generation failed."), "The request took too long. Try again.");
});

test("the route's own error wins, and any other non-JSON answer falls back", async () => {
  const routeError = new Response(JSON.stringify({ error: "Add a Source URL." }), { status: 400 });

  assert.equal(studioFailure(routeError, await readStudioJson(routeError), "Failed."), "Add a Source URL.");

  const badGateway = new Response("<html>Bad gateway</html>", { status: 502 });

  assert.equal(studioFailure(badGateway, await readStudioJson(badGateway), "Failed."), "Failed.");
});
