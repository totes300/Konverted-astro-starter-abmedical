import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeSignatureHeader, SIGNATURE_HEADER_NAME } from "@sanity/webhook";
import { parseWebhookJson, verifyWebhookDelivery, WEBHOOK_MAX_AGE_MS, WEBHOOK_SIGNATURE_HEADER } from "./webhook-signature";

const NOW = 1_760_000_000_000;

// `v1=abc` never matches, so a header that passes the age check comes back "invalid", not "stale".
const isFresh = async (header: string | null) => (await verifyWebhookDelivery("{}", header, "secret", NOW)) !== "stale";

test("the header name is the one Sanity sends", () => {
  assert.equal(WEBHOOK_SIGNATURE_HEADER, SIGNATURE_HEADER_NAME);
});

test("a signature signed just now is fresh", async () => {
  assert.equal(await isFresh(`t=${NOW},v1=abc`), true);
  assert.equal(await isFresh(`t=${NOW - 1000}, v1=abc`), true);
});

test("a delivery that waited in Sanity's queue for half an hour is still fresh", async () => {
  assert.equal(await isFresh(`t=${NOW - 30 * 60 * 1000},v1=abc`), true);
  assert.equal(await isFresh(`t=${NOW - WEBHOOK_MAX_AGE_MS},v1=abc`), true);
});

test("a replayed body older than the window is refused", async () => {
  assert.equal(await isFresh(`t=${NOW - WEBHOOK_MAX_AGE_MS - 1},v1=abc`), false);
  assert.equal(await isFresh(`t=${NOW - 24 * 60 * 60 * 1000},v1=abc`), false);
});

test("a timestamp more than a minute in the future is refused", async () => {
  assert.equal(await isFresh(`t=${NOW + 60 * 1000},v1=abc`), true);
  assert.equal(await isFresh(`t=${NOW + 60 * 1000 + 1},v1=abc`), false);
  assert.equal(await isFresh(`t=${NOW + 10 * 60 * 1000},v1=abc`), false);
});

test("a missing or malformed header is refused", async () => {
  const garbage = [
    null,
    "",
    "v1=abc",
    `t=${NOW}`,
    "t=abc,v1=abc",
    "t=99999999999999999999999,v1=abc",
    `t=${NOW},v1=abc,v1=def`,
    `t=-${NOW},v1=abc`,
    `t=${NOW};v1=abc`,
    `v1=abc,t=${NOW}`,
  ];

  for (const header of garbage) {
    assert.equal(await isFresh(header), false, String(header));
  }
});

const SECRET = "a".repeat(64);
const BODY = JSON.stringify({ _id: "drafts.page.home", _type: "page", uri: "/" });

test("verifyWebhookDelivery: an unsigned body that is not JSON is invalid, never a parse error", async () => {
  for (const raw of ["{", "not json", '{"_id":', "\u0000", ""]) {
    assert.equal(await verifyWebhookDelivery(raw, `t=${NOW},v1=forged`, SECRET, NOW), "invalid", JSON.stringify(raw));
  }
});

test("verifyWebhookDelivery: a body signed with another secret, or altered after signing, is invalid", async () => {
  assert.equal(await verifyWebhookDelivery(BODY, await encodeSignatureHeader(BODY, NOW, "b".repeat(64)), SECRET, NOW), "invalid");

  const header = await encodeSignatureHeader(BODY, NOW, SECRET);
  assert.equal(await verifyWebhookDelivery(BODY.replace("page.home", "page.other"), header, SECRET, NOW), "invalid");
  assert.equal(await verifyWebhookDelivery(BODY, header.replace(`t=${NOW}`, `t=${NOW + 1}`), SECRET, NOW), "invalid");
});

test("verifyWebhookDelivery: a signature one character off, too long or too short is invalid; separator spacing is not", async () => {
  const header = await encodeSignatureHeader(BODY, NOW, SECRET);
  const lastChar = header.at(-1) === "A" ? "B" : "A";

  assert.equal(await verifyWebhookDelivery(BODY, `${header.slice(0, -1)}${lastChar}`, SECRET, NOW), "invalid");
  assert.equal(await verifyWebhookDelivery(BODY, `${header}A`, SECRET, NOW), "invalid");
  assert.equal(await verifyWebhookDelivery(BODY, header.slice(0, -1), SECRET, NOW), "invalid");
  assert.equal(await verifyWebhookDelivery(BODY, header.replace(",v1=", ", v1="), SECRET, NOW), "ok");
});

test("verifyWebhookDelivery: no header, or a correctly signed but stale one, is stale", async () => {
  const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;

  assert.equal(await verifyWebhookDelivery(BODY, null, SECRET, NOW), "stale");
  assert.equal(await verifyWebhookDelivery(BODY, await encodeSignatureHeader(BODY, twoHoursAgo, SECRET), SECRET, NOW), "stale");
});

test("verifyWebhookDelivery: a captured delivery replays only inside the window", async () => {
  const header = await encodeSignatureHeader(BODY, NOW, SECRET);

  assert.equal(await verifyWebhookDelivery(BODY, header, SECRET, NOW + 10 * 60 * 1000), "ok");
  assert.equal(await verifyWebhookDelivery(BODY, header, SECRET, NOW + WEBHOOK_MAX_AGE_MS + 1), "stale");
});

test("verifyWebhookDelivery: a fresh, correctly signed body is ok", async () => {
  assert.equal(await verifyWebhookDelivery(BODY, await encodeSignatureHeader(BODY, NOW, SECRET), SECRET, NOW), "ok");
});

test("parseWebhookJson: text that is not JSON is null, not a throw", () => {
  assert.equal(parseWebhookJson("{"), null);
  assert.equal(parseWebhookJson(""), null);
  assert.deepEqual(parseWebhookJson(BODY), { _id: "drafts.page.home", _type: "page", uri: "/" });
});
