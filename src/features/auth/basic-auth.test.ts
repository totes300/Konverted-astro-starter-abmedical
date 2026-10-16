import assert from "node:assert/strict";
import { test } from "node:test";
import {
  basicAuthChallenge,
  basicAuthorizationHeader,
  decodeBasicAuthHeader,
  hasBasicCredentials,
  timingSafeEqual,
} from "./basic-auth";

test("decodeBasicAuthHeader reads the credentials out of a Basic header", () => {
  assert.deepEqual(decodeBasicAuthHeader(`Basic ${btoa("editor:s3cret")}`), {
    username: "editor",
    password: "s3cret",
  });
});

test("decodeBasicAuthHeader keeps colons inside the password", () => {
  assert.deepEqual(decodeBasicAuthHeader(`Basic ${btoa("editor:a:b")}`), {
    username: "editor",
    password: "a:b",
  });
});

test("decodeBasicAuthHeader accepts the scheme in any case with surrounding whitespace", () => {
  assert.deepEqual(decodeBasicAuthHeader(`basic   ${btoa("editor:s3cret")}  `), { username: "editor", password: "s3cret" });
});

test("decodeBasicAuthHeader rejects anything that is not one decodable Basic token", () => {
  assert.equal(decodeBasicAuthHeader(null), null);
  assert.equal(decodeBasicAuthHeader("Bearer token"), null);
  assert.equal(decodeBasicAuthHeader("Basic !!!not-base64!!!"), null);
  assert.equal(decodeBasicAuthHeader(`Basic ${btoa("no-colon")}`), null);
  assert.equal(decodeBasicAuthHeader(`Basic ${btoa("editor:s3cret")} extra`), null);
  assert.equal(decodeBasicAuthHeader("Basic"), null);
});

test("timingSafeEqual compares by value, not by prefix or length", () => {
  assert.equal(timingSafeEqual("secret", "secret"), true);
  assert.equal(timingSafeEqual("secret", "secreT"), false);
  assert.equal(timingSafeEqual("secret", "secret-longer"), false);
  assert.equal(timingSafeEqual("secret", "secre"), false);
  assert.equal(timingSafeEqual("", ""), true);
  assert.equal(timingSafeEqual("", "secret"), false);
  assert.equal(timingSafeEqual("pässwort", "pässwort"), true);
});

test("basicAuthorizationHeader rebuilds the header a browser replays", () => {
  const header = basicAuthorizationHeader("editor", "s3cret");

  assert.equal(header, `Basic ${btoa("editor:s3cret")}`);
  assert.deepEqual(decodeBasicAuthHeader(header), { username: "editor", password: "s3cret" });
});

test("basicAuthorizationHeader returns null when Basic Auth cannot run", () => {
  assert.equal(basicAuthorizationHeader("", "s3cret"), null);
  assert.equal(basicAuthorizationHeader("  ", "s3cret"), null);
  assert.equal(basicAuthorizationHeader("editor", ""), null);
  // Outside latin1: btoa cannot encode it and the gate's atob decode could not match it either.
  assert.equal(basicAuthorizationHeader("editor", "パスワード"), null);
});

test("hasBasicCredentials accepts only the exact username and password", () => {
  const header = `Basic ${btoa("editor:s3cret")}`;

  assert.equal(hasBasicCredentials(header, "editor", "s3cret"), true);
  assert.equal(hasBasicCredentials(header, "editor", "wrong"), false);
  assert.equal(hasBasicCredentials(header, "other", "s3cret"), false);
  assert.equal(hasBasicCredentials(null, "editor", "s3cret"), false);
});

test("hasBasicCredentials rejects a prefix or an extension of either half", () => {
  assert.equal(hasBasicCredentials(`Basic ${btoa("editor:s3cre")}`, "editor", "s3cret"), false);
  assert.equal(hasBasicCredentials(`Basic ${btoa("editor:s3cret-longer")}`, "editor", "s3cret"), false);
  assert.equal(hasBasicCredentials(`Basic ${btoa("edito:s3cret")}`, "editor", "s3cret"), false);
  assert.equal(hasBasicCredentials(`Basic ${btoa(":")}`, "editor", "s3cret"), false);
});

test("basicAuthChallenge asks the browser for credentials", () => {
  const response = basicAuthChallenge();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("WWW-Authenticate"), 'Basic realm="Protected"');
});
