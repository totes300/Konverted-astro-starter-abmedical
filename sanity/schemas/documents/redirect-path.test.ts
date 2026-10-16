import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_REDIRECT_PATH_LENGTH,
  type RedirectPathRules,
  redirectFromProblem,
  redirectLoops,
  redirectToProblem,
} from "./redirect-path";

const EXACT: RedirectPathRules = { patterns: false, reservedPaths: ["/api", "/studio"] };
const PATTERNS: RedirectPathRules = { ...EXACT, patterns: true };

describe("redirectFromProblem", () => {
  it("accepts plain same-site paths", () => {
    for (const from of ["/", "/about", "/old/", "/studio-old", "/apis"]) {
      assert.equal(redirectFromProblem(from, EXACT), null, from);
    }
  });

  it("refuses a % escape when the host matches exact paths, and keeps it when it takes patterns", () => {
    for (const from of ["/caf%C3%A9", "/a%2Db", "/old/%7E"]) {
      assert.match(redirectFromProblem(from, EXACT) ?? "", /"%" escape/, from);
      assert.equal(redirectFromProblem(from, PATTERNS), null, from);
    }

    assert.doesNotMatch(redirectFromProblem("/über", EXACT) ?? "", /%/);
  });

  it("refuses an anchor or a query, since a From path matches the address alone", () => {
    for (const from of ["/old#x", "/old?x=1", "/#contact"]) {
      assert.match(redirectFromProblem(from, EXACT) ?? "", /anchor/, from);
    }
  });

  it("refuses paths outside the plain subset", () => {
    for (const from of [
      "about",
      "//evil.example",
      "/a b",
      "/a\\b",
      "/a\u0001b",
      "/a//b",
      "/a/../b",
      "/./a",
      "/%2F%2Fevil.example",
      "/%5Cevil",
      "/%E0%A4%A",
      "/über",
      "/a<b",
    ]) {
      assert.notEqual(redirectFromProblem(from, EXACT), null, JSON.stringify(from));
    }
  });

  it("refuses the reserved paths and anything under /_, in any spelling", () => {
    for (const rules of [EXACT, PATTERNS]) {
      for (const from of [
        "/api",
        "/api/revalidate",
        "/API/x",
        "/%61pi",
        "/studio",
        "/Studio/structure",
        "/%73tudio/x",
        "/_internal/x.js",
        "/%5Finternal",
      ]) {
        assert.notEqual(redirectFromProblem(from, rules), null, `${from} (patterns: ${rules.patterns})`);
      }
    }

    assert.match(redirectFromProblem("/%61pi", PATTERNS) ?? "", /reserved/);
    assert.match(redirectFromProblem("/%5Finternal", PATTERNS) ?? "", /"\/_"/);
  });

  it("refuses parameters when the host matches exact paths, and keeps whole-segment ones when it takes patterns", () => {
    for (const from of ["/blog/:slug", "/old/:path*", "/[...rest]", "/a*"]) {
      assert.match(redirectFromProblem(from, EXACT) ?? "", /exact paths/, from);
    }

    for (const from of ["/blog/:slug", "/old/:path*", "/old/:path+", "/old/:path?"]) {
      assert.equal(redirectFromProblem(from, PATTERNS), null, from);
    }
  });

  it("refuses a pattern that could capture a reserved path, or repeats a parameter", () => {
    for (const from of ["/:slug", "/:a/revalidate", "/api/:slug", "/a-:b", "/a/(.*)", "/:a/:a"]) {
      assert.notEqual(redirectFromProblem(from, PATTERNS), null, from);
    }
  });

  it("keeps a path at the length cap and refuses one past it", () => {
    const path = `/${"a".repeat(MAX_REDIRECT_PATH_LENGTH - 1)}`;

    assert.equal(redirectFromProblem(path, EXACT), null);
    assert.notEqual(redirectFromProblem(`${path}a`, EXACT), null);
  });
});

describe("redirectToProblem", () => {
  it("accepts a plain path with an optional query and section anchor", () => {
    for (const to of ["/", "/about-us", "/new?ref=old&x=1", "/#contact", "/about#team", "/new?ref=old#x", "/#"]) {
      assert.equal(redirectToProblem(to, "/old", EXACT), null, to);
    }
  });

  it("keeps a % escape in a To path whichever way the host matches", () => {
    for (const rules of [EXACT, PATTERNS]) {
      assert.equal(redirectToProblem("/caf%C3%A9", "/cafe", rules), null);
    }
  });

  it("refuses an anchor or a query outside the plain characters", () => {
    for (const to of [
      "/a#b#c",
      "/a#<x>",
      "/a#//evil.example",
      "/new?a=1?b=2",
      "/new?next=//evil.example",
      "/new?next=//evil.example#x",
    ]) {
      assert.notEqual(redirectToProblem(to, "/old", EXACT), null, to);
    }
  });

  it("refuses off-site and non-path destinations", () => {
    for (const to of [
      "//evil.example",
      "/\\evil.example",
      "/%09/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "",
    ]) {
      assert.notEqual(redirectToProblem(to, "/old", EXACT), null, JSON.stringify(to));
    }
  });

  it("refuses a parameter the From path does not have", () => {
    assert.equal(redirectToProblem("/articles/:slug", "/blog/:slug", PATTERNS), null);
    assert.match(redirectToProblem("/articles/:id", "/blog/:slug", PATTERNS) ?? "", /:id/);
    assert.match(redirectToProblem("/articles/:slug", "/blog/:slug", EXACT) ?? "", /exact paths/);
  });
});

describe("redirectLoops", () => {
  it("loops when To differs from From only by letter case, an anchor, a query or a trailing slash", () => {
    const loops: [string, string][] = [
      ["/contact", "/contact#form"],
      ["/a", "/a?x=1"],
      ["/a", "/a/"],
      ["/a/", "/a"],
      ["/blog/:slug", "/blog/:slug#x"],
      ["/a", "/a/?x=1#y"],
      ["/", "/#contact"],
      ["/", "/?"],
      ["/About-Us", "/about-us"],
      ["/Blog/:slug", "/blog/:slug"],
      ["/blog/:rest*", "/blog"],
      ["/docs/:page?", "/Docs/"],
    ];

    for (const [from, to] of loops) {
      assert.equal(redirectLoops(from, to), true, `${from} -> ${to}`);
    }
  });

  it("does not loop when To names another address", () => {
    const moves: [string, string][] = [
      ["/a", "/b"],
      ["/a", "/a/b"],
      ["/a/b", "/a"],
      ["/blog/:slug", "/articles/:slug"],
      ["/", "/about#team"],
      ["/blog/:slug", "/blog"],
      ["/blog/:rest+", "/blog"],
    ];

    for (const [from, to] of moves) {
      assert.equal(redirectLoops(from, to), false, `${from} -> ${to}`);
    }
  });
});
