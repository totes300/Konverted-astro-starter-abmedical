import assert from "node:assert/strict";
import { test } from "node:test";
import { BASIC_AUTH_STATE_QUERY, isProtectedPath, toBasicAuthState } from "./basic-auth-state";
import { canonicalRequestPath } from "./canonical-path";

test("the state query reads the settings singleton by id, never by type", () => {
  assert.match(BASIC_AUTH_STATE_QUERY, /\*\[_id == "siteSettings"\]\[0\]\.basicAuth/);
  assert.doesNotMatch(BASIC_AUTH_STATE_QUERY, /_type == "siteSettings"/);
});

test("toBasicAuthState is closed only on an explicit true, and tolerates a missing payload", () => {
  assert.equal(toBasicAuthState(null).siteWideEnabled, false);
  assert.equal(toBasicAuthState({ basicAuth: { siteWideEnabled: true } }).siteWideEnabled, true);
  assert.equal(toBasicAuthState({ protectedPaths: null }).protectedPathSet.size, 0);
  assert.equal(toBasicAuthState({ protectedPaths: [null, "/a"] }).protectedPathSet.size, 1);
});

test("a protected Unicode URI is protected under every request spelling", () => {
  const state = toBasicAuthState({ protectedPaths: ["/über-uns", "/team/"] });

  for (const spelling of [
    "/über-uns",
    "/%C3%BCber-uns",
    "/u%CC%88ber-uns",
    "/%C3%BCber-uns/",
    "/über-uns.html",
    "/team",
    "/team.html",
  ]) {
    const path = canonicalRequestPath(spelling);

    assert.ok(path, spelling);
    assert.equal(isProtectedPath(state, path), true, spelling);
  }

  assert.equal(isProtectedPath(state, "/about"), false);
});

test("a URI stored decomposed or without its slash still protects its page", () => {
  const state = toBasicAuthState({ protectedPaths: ["/über-uns".normalize("NFD"), "secret"] });

  assert.equal(isProtectedPath(state, "/über-uns"), true);
  assert.equal(isProtectedPath(state, "/secret"), true);
});

test("site-wide protection covers every path", () => {
  const state = toBasicAuthState({ basicAuth: { siteWideEnabled: true } });

  assert.equal(isProtectedPath(state, "/"), true);
  assert.equal(isProtectedPath(state, "/anything"), true);
});
