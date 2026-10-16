import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDraftSession,
  DRAFT_SESSION_MAX_AGE_SECONDS,
  hasPreviewSecretShape,
  safeRedirectPath,
  safeRedirectUrl,
  verifyDraftSession,
} from "./draft-session";

const SECRET = "server-only-secret";
const NOW = Date.UTC(2026, 0, 1);

test("a session this server signed verifies until it expires", async () => {
  const value = await createDraftSession(SECRET, NOW);

  assert.equal(await verifyDraftSession(SECRET, value, NOW), true);
  assert.equal(await verifyDraftSession(SECRET, value, NOW + (DRAFT_SESSION_MAX_AGE_SECONDS - 1) * 1000), true);
  assert.equal(await verifyDraftSession(SECRET, value, NOW + (DRAFT_SESSION_MAX_AGE_SECONDS + 1) * 1000), false);
});

test("anything a client could type is rejected", async () => {
  const value = await createDraftSession(SECRET, NOW);
  const [expiresAt, signature] = value.split(".");

  for (const forged of [
    "",
    "drafts",
    "1",
    "anything",
    `${expiresAt}`,
    `${expiresAt}.`,
    `${Number(expiresAt) + 3600}.${signature}`,
    `${expiresAt}.${signature}x`,
    `${expiresAt}.${signature}.extra`,
    `${expiresAt}.${"A".repeat(signature?.length ?? 43)}`,
  ]) {
    assert.equal(await verifyDraftSession(SECRET, forged, NOW), false, forged);
  }

  assert.equal(await verifyDraftSession(SECRET, null, NOW), false);
  assert.equal(await verifyDraftSession(SECRET, undefined, NOW), false);
});

test("a session signed with another secret is rejected, and an empty secret never verifies", async () => {
  const value = await createDraftSession("some-other-secret", NOW);
  assert.equal(await verifyDraftSession(SECRET, value, NOW), false);
  assert.equal(await verifyDraftSession("", value, NOW), false);
  assert.equal(await verifyDraftSession("", await createDraftSession("", NOW), NOW), false);
});

test("a session expiring later than a fresh one would is rejected, even when correctly signed", async () => {
  const value = await createDraftSession(SECRET, NOW);
  const slightlyLater = await createDraftSession(SECRET, NOW + 30 * 1000);
  const anHourLater = await createDraftSession(SECRET, NOW + 60 * 60 * 1000);
  const decadesLater = await createDraftSession(SECRET, NOW + 20 * 365 * 24 * 60 * 60 * 1000);

  assert.equal(await verifyDraftSession(SECRET, value, NOW), true);
  assert.equal(await verifyDraftSession(SECRET, slightlyLater, NOW), true);
  assert.equal(await verifyDraftSession(SECRET, anHourLater, NOW), false);
  assert.equal(await verifyDraftSession(SECRET, decadesLater, NOW), false);
  assert.equal(await verifyDraftSession(SECRET, `9999999999999999999.${decadesLater.split(".")[1]}`, NOW), false);
});

test("a validly signed session spelled another way is rejected", async () => {
  const value = await createDraftSession(SECRET, NOW);
  const [expiresAt, signature] = value.split(".");
  const expires = Number(expiresAt);

  assert.equal(await verifyDraftSession(SECRET, value, NOW), true);

  for (const spelling of [
    ` ${expiresAt}`,
    `${expiresAt} `,
    `0x${expires.toString(16)}`,
    `0${expiresAt}`,
    `${expires}.0`,
    `+${expiresAt}`,
  ]) {
    assert.equal(await verifyDraftSession(SECRET, `${spelling}.${signature}`, NOW), false, spelling);
  }
});

test("the cookie is keyed with neither the raw secret nor the previous key", async () => {
  const value = await createDraftSession(SECRET, NOW);
  const [expiresAt, signature] = value.split(".");

  for (const keyMaterial of [SECRET, `draft-session:v1:${SECRET}`]) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(keyMaterial),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiresAt)));
    const forged = Buffer.from(new Uint8Array(signed)).toString("base64url");

    assert.notEqual(signature, forged);
    assert.equal(await verifyDraftSession(SECRET, `${expiresAt}.${forged}`, NOW), false);
  }
});

test("hasPreviewSecretShape passes what the Sanity generator makes and nothing else", () => {
  for (let run = 0; run < 50; run++) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const generated = btoa(hex).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    assert.equal(hasPreviewSecretShape(generated), true, generated);
  }

  for (const value of [
    null,
    undefined,
    "",
    "x",
    "a".repeat(19),
    "a".repeat(65),
    "a".repeat(100_000),
    '" || true || "',
    "$secret",
    "*[_type == 'sanity.previewUrlSecret']",
    "abcdefghijklmnopqrstuvwxyz==",
    "abcdefghij klmnopqrstuvwxyz",
    "abcdefghij/klmnopqrstuvwxyz",
    "abcdefghij+klmnopqrstuvwxyz",
    "abcdefghij%00klmnopqrstuvwxyz",
    "abcdefghijklmnopqrstuvwxyz\n",
    "abcdéfghijklmnopqrstuvwxyz",
  ]) {
    assert.equal(hasPreviewSecretShape(value), false, String(value).slice(0, 40));
  }
});

const ORIGIN = "https://www.example.com";

test("safeRedirectUrl keeps same-origin paths with their query and hash", () => {
  assert.equal(safeRedirectUrl("/blog/post?x=1#top", ORIGIN).href, `${ORIGIN}/blog/post?x=1#top`);
  assert.equal(safeRedirectUrl("/", ORIGIN).href, `${ORIGIN}/`);
  assert.equal(safeRedirectUrl("/a/../b", ORIGIN).href, `${ORIGIN}/b`);
  assert.equal(safeRedirectPath("/blog/post?x=1#top", ORIGIN), "/blog/post?x=1#top");
  assert.equal(safeRedirectPath("/blog/post?x=1"), "/blog/post?x=1");
  assert.equal(safeRedirectPath("/?sanity-preview-perspective=drafts", ORIGIN), "/?sanity-preview-perspective=drafts");
});

test("safeRedirectUrl refuses every escape to another host", () => {
  for (const unsafe of [
    "/\t/x",
    "/\n/x",
    "/\r/x",
    "/\t/evil.com",
    "/\t\\evil.com",
    "/\u007f/evil.com",
    "//x",
    "//evil.com",
    "/\\x",
    "/\\evil.com",
    "/.//x",
    "/.//evil.com",
    "/a/..//x",
    "/..//evil.com",
    "/x/../..//evil.com",
    "/.%2e//evil.com",
    "///evil.com",
    "/%2F/x",
    "https://x",
    "https://evil.com",
    "javascript:x",
    "javascript:alert(1)",
    "evil.com",
    "",
    " /evil.com",
    null,
    undefined,
  ]) {
    const target = safeRedirectUrl(unsafe, ORIGIN);
    const path = safeRedirectPath(unsafe, ORIGIN);

    assert.equal(target.origin, ORIGIN, String(unsafe));
    assert.equal(target.pathname.startsWith("//"), false, String(unsafe));
    assert.equal(path.startsWith("//"), false, String(unsafe));
    assert.equal(new URL(path, ORIGIN).origin, ORIGIN, String(unsafe));
    assert.equal(safeRedirectPath(unsafe).startsWith("//"), false, String(unsafe));
  }

  for (const unsafe of ["/\t/x", "/\n/x", "//x", "/\\x", "/.//x", "/a/..//x", "https://x", "javascript:x"]) {
    assert.equal(safeRedirectPath(unsafe, ORIGIN), "/", unsafe);
  }

  assert.equal(safeRedirectPath("/%2F/x", ORIGIN), "/%2F/x");
});
