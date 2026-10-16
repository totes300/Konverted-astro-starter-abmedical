import assert from "node:assert/strict";
import { test } from "node:test";
import { tokenColor } from "./token-color";

const STEGA_SUFFIX = "​‌‍﻿";

test("a palette name resolves to its CSS variable", () => {
  assert.equal(tokenColor("brand-accent"), "var(--color-brand-accent)");
  assert.equal(tokenColor("brand-off-white"), "var(--color-brand-off-white)");
  assert.equal(tokenColor(" brand-accent "), "var(--color-brand-accent)");
  assert.equal(tokenColor(`brand-accent${STEGA_SUFFIX}`), "var(--color-brand-accent)");
});

test("a strict hex resolves to itself, trimmed and without draft mode's invisible characters", () => {
  for (const [value, expected] of [
    ["#fff", "#fff"],
    ["#FFF", "#FFF"],
    ["#fffa", "#fffa"],
    ["#ff9100", "#ff9100"],
    ["#FF9100cc", "#FF9100cc"],
    [" #ff9100\n", "#ff9100"],
    [`#ff9100${STEGA_SUFFIX}`, "#ff9100"],
  ]) {
    assert.equal(tokenColor(value), expected, JSON.stringify(value));
  }
});

test("anything else resolves to no colour rather than reaching the style attribute", () => {
  for (const value of [
    null,
    undefined,
    "",
    " ",
    "red",
    "danger",
    "BRAND-ACCENT",
    "var(--color-brand-accent)",
    "rgb(255, 145, 0)",
    "ff9100",
    "##ff9100",
    "#ff",
    "#ff910",
    "#ff91000",
    "#ff9100ccc",
    "#gggggg",
    "#ff​9100",
    "#ff9100 !important",
    "#ff9100;position:fixed",
    "#ff9100\n;position:fixed",
    "#ff9100);position:fixed;inset:0;background:url(https://evil.example/beacon",
    "x); background: url(https://example.org/beacon",
    "x);position:fixed;inset:0;background:url(https://evil.example/beacon",
    "brand-accent);position:fixed;inset:0",
    "brand-accent;position:fixed",
    "brand-accent) url(https://example.org/x",
    "brand-accent) url(https://evil.example/x",
  ]) {
    assert.equal(tokenColor(value), undefined, JSON.stringify(value));
  }
});
