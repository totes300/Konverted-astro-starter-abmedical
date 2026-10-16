import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, parse } from "groq-js";
import { MediaFunctions, media } from "./fragment";

const IMAGE_ASSET = { _id: "image-asset", _type: "sanity.imageAsset", metadata: { dimensions: { aspectRatio: 1.5 } } };
const BARE_ASSET = { _id: "bare-asset", _type: "sanity.imageAsset" };
const BEACON = "1;position:fixed;inset:0;background:url(https://evil.example/beacon";

async function aspectRatioOf(value: Record<string, unknown>): Promise<unknown> {
  const query = `${MediaFunctions} *[_id == "doc"][0]{ "media": ${media("media")} }.media.aspectRatio`;
  const dataset = [IMAGE_ASSET, BARE_ASSET, { _id: "doc", _type: "doc", media: value }];

  return (await evaluate(parse(query), { dataset })).get();
}

const image = (aspectRatio: unknown, ref = IMAGE_ASSET._id) => ({ type: "image", image: { asset: { _ref: ref } }, aspectRatio });

test("a positive stored aspect ratio is passed through", async () => {
  assert.equal(await aspectRatioOf(image(16 / 9)), 16 / 9);
  assert.equal(await aspectRatioOf(image(0.5)), 0.5);
});

test("anything but a positive number falls back to the asset's own ratio", async () => {
  for (const stored of [BEACON, "16/9", "2", 0, -1, null, true, { x: 1 }]) {
    assert.equal(await aspectRatioOf(image(stored)), 1.5, String(stored));
  }
});

test("with no asset ratio to fall back to, a hostile value becomes null", async () => {
  for (const stored of [BEACON, "16/9", -1]) {
    assert.equal(await aspectRatioOf(image(stored, BARE_ASSET._id)), null, String(stored));
  }
});
