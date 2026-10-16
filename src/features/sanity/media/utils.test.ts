import assert from "node:assert/strict";
import { test } from "node:test";
import { cssAspectRatio, safeLqip, safeVideoSrc } from "./utils";

const LQIP = "data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsj/2w==";

test("cssAspectRatio keeps a positive ratio", () => {
  assert.equal(cssAspectRatio(1), 1);
  assert.equal(cssAspectRatio(16 / 9), 16 / 9);
  assert.equal(cssAspectRatio(5 / 7), 5 / 7);
});

test("cssAspectRatio clamps a ratio no real asset has", () => {
  assert.equal(cssAspectRatio(1e9), 20);
  assert.equal(cssAspectRatio(1e-9), 1 / 20);
});

test("cssAspectRatio drops anything that is not a positive finite number", () => {
  for (const value of [
    "1;position:fixed;inset:0;background:url(https://evil.example/beacon",
    "16/9",
    "1",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    null,
    undefined,
    { toString: () => "1" },
  ]) {
    assert.equal(cssAspectRatio(value), undefined, String(value));
  }
});

test("safeLqip keeps the base64 image data URI an asset carries", () => {
  assert.equal(safeLqip(LQIP), LQIP);
  assert.equal(safeLqip("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
});

test("safeLqip drops anything that could close url(...) or load from elsewhere", () => {
  for (const value of [
    `${LQIP}),url(https://evil.example/beacon`,
    `${LQIP});position:fixed;inset:0`,
    `${LQIP}"`,
    `${LQIP} `,
    "https://evil.example/beacon.png",
    "//evil.example/beacon.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4=",
    "data:image/jpeg,raw",
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(safeLqip(value), undefined, String(value));
  }
});

test("safeVideoSrc keeps an uploaded file, an external https video and a site path", () => {
  for (const value of ["https://cdn.sanity.io/files/p/d/abc.mp4", "https://videos.example/clip.mp4", "/media/clip.mp4"]) {
    assert.equal(safeVideoSrc(value), value);
  }
});

test("safeVideoSrc drops a runnable, inline or off-site-by-trick source, and a stored value that is not a string", () => {
  for (const value of [
    "javascript:x",
    "data:video/mp4,x",
    "//evil.example/v.mp4",
    "/\\evil.example/v.mp4",
    "/\t/evil.example/v.mp4",
    "",
    null,
    undefined,
    42,
    { url: "https://videos.example/clip.mp4" },
  ]) {
    assert.equal(safeVideoSrc(value), undefined, String(value));
  }
});
