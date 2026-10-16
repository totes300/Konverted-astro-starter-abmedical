import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redirectFromProblem, redirectLoops, redirectToProblem } from "~/sanity/schemas/documents/redirect-path";
import { MAX_REDIRECT_PATH_LENGTH, redirectProblem, siteHostsOf, toConfigRedirects } from "./cms-redirects.mjs";

const RULES = { siteHosts: ["example.com", "www.example.com"], reservedPaths: ["/api", "/studio"] };

function allowed(from: string, to: string) {
  return redirectProblem(from, to, RULES) === null;
}

function refused(from: string, to: string) {
  return redirectProblem(from, to, RULES) !== null;
}

describe("redirectProblem: accepted", () => {
  it("accepts plain same-site paths", () => {
    assert.ok(allowed("/about", "/about-us"));
    assert.ok(allowed("/old/", "/new/"));
    assert.ok(allowed("/old", "/"));
    assert.ok(allowed("/old", "/new?ref=old&x=1"));
    assert.ok(allowed("/cafe", "/caf%C3%A9"));
    assert.ok(allowed("/studio-old", "/x"));
    assert.ok(allowed("/apis", "/x"));
  });

  it("accepts an https destination on the site's own hosts", () => {
    assert.ok(allowed("/old", "https://www.example.com/new"));
    assert.ok(allowed("/old", "https://example.com"));
    assert.ok(allowed("/old", "https://www.example.com#x"));
    assert.ok(allowed("/old", "https://example.com?x=1"));
    assert.ok(allowed("/old", "https://example.com?x=1#y"));
  });

  it("accepts a destination with a section anchor", () => {
    assert.ok(allowed("/old", "/#contact"));
    assert.ok(allowed("/old", "/about#team"));
    assert.ok(allowed("/old", "/new?ref=old#x"));
    assert.ok(allowed("/old", "https://www.example.com/#x"));
  });
});

describe("redirectProblem: open redirects", () => {
  it("refuses protocol-relative, backslash, whitespace and control-character destinations", () => {
    for (const to of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/ /evil",
      "/\t/evil.example",
      "/\n/evil.example",
      "/%09/evil.example",
      "/%2F%2Fevil.example",
      "/%5Cevil.example",
      "/%E0%A4%A",
      "/.//evil.example",
      "/a/..//evil.example",
    ]) {
      assert.ok(refused("/a", to), JSON.stringify(to));
    }
  });

  it("refuses off-site, non-https and non-path destinations", () => {
    for (const to of [
      "https://evil.example",
      "https://www.example.com.evil.example/",
      "https://user@www.example.com/",
      "https://www.example.com@evil.example/",
      "http://www.example.com/",
      "javascript:alert(1)",
      "mailto:a@example.com",
      "data:text/html,x",
      "evil.example",
      "",
    ]) {
      assert.ok(refused("/a", to), JSON.stringify(to));
    }
  });

  it("refuses a query that could smuggle a second URL", () => {
    assert.ok(refused("/old", "/new?a=1?b=2"));
    assert.ok(refused("/old", "/new?next=//evil.example"));
    assert.ok(refused("/old", "/new?next=//evil.example#x"));
  });

  it("refuses an anchor outside the plain characters", () => {
    for (const to of ["/a#b#c", "/a#<x>", "/a#b c", "/a#//evil.example", "/a#b?c"]) {
      assert.ok(refused("/old", to), JSON.stringify(to));
    }
  });

  it("refuses an anchor or a query on the source", () => {
    assert.ok(refused("/old#x", "/new"));
    assert.ok(refused("/old?x=1", "/new"));
  });

  it("refuses a bare-host https destination whose anchor or query is not plain", () => {
    for (const to of [
      "https://www.example.com#//evil.example",
      "https://example.com?next=//evil.example",
      "https://example.com#<x>",
    ]) {
      assert.ok(refused("/old", to), to);
    }
  });
});

describe("redirectProblem: sources", () => {
  it("refuses a % escape, since Astro matches the decoded request path", () => {
    for (const from of ["/caf%C3%A9", "/a%2Db", "/old/%7E"]) {
      assert.match(redirectProblem(from, "/x", RULES) ?? "", /% escape/, from);
    }
  });

  it("refuses patterns, since Astro matches exact paths", () => {
    for (const from of ["/blog/[slug]", "/[...rest]", "/blog/:slug", "/a/(.*)", "/a*"]) {
      assert.ok(refused(from, "/x"), from);
    }
  });

  it("refuses sources that are not plain same-site paths", () => {
    for (const from of ["//evil.example", "about", "https://www.example.com/a", "/a b", "/a\\b", "/a//b", "/a/../b", ""]) {
      assert.ok(refused(from, "/b"), JSON.stringify(from));
    }
  });

  it("refuses sources under the API, the Studio and framework paths, in any spelling", () => {
    for (const from of [
      "/api",
      "/api/revalidate",
      "/API/draft-mode/enable",
      "/%61pi/revalidate",
      "/studio",
      "/Studio/structure",
      "/%73tudio",
      "/_astro/x.js",
      "/_image",
      "/_server-islands/x",
    ]) {
      assert.ok(refused(from, "/x"), from);
    }
  });
});

describe("redirectProblem: loops", () => {
  it("refuses a destination that is the source's own address once the anchor, query, trailing slash and letter case are set aside", () => {
    const loops: [string, string][] = [
      ["/contact", "/contact#form"],
      ["/a", "/a?x=1"],
      ["/a", "/a/"],
      ["/a/", "/a"],
      ["/a", "/a/?x=1#y"],
      ["/", "/#contact"],
      ["/", "https://example.com"],
      ["/old", "https://www.example.com/old#x"],
      ["/old", "https://example.com/old/?x=1"],
      ["/About-Us", "/about-us"],
      ["/old", "https://example.com/OLD"],
    ];

    for (const [from, to] of loops) {
      assert.match(redirectProblem(from, to, RULES) ?? "", /loop/, `${from} -> ${to}`);
    }
  });

  it("accepts a destination at another address", () => {
    const moves: [string, string][] = [
      ["/a", "/b"],
      ["/a", "/a/b"],
      ["/a/b", "/a"],
      ["/", "/about#team"],
      ["/old", "https://example.com/new#old"],
    ];

    for (const [from, to] of moves) {
      assert.ok(allowed(from, to), `${from} -> ${to}`);
    }
  });
});

describe("redirectProblem: length", () => {
  it("keeps an entry at the cap and refuses one past it", () => {
    const path = `/${"a".repeat(MAX_REDIRECT_PATH_LENGTH - 1)}`;
    assert.ok(allowed(path, "/b"));
    assert.ok(refused(`${path}a`, "/b"));
    assert.ok(refused("/old", `/${"b".repeat(5000)}`));
  });
});

describe("Studio validation", () => {
  it("refuses exactly the paths the build drops", () => {
    const studioRules = { patterns: false, reservedPaths: RULES.reservedPaths };
    const froms = ["/", "/new", "/about", "/old/", "/caf%C3%A9", "/apis", "/api", "/API/x", "/%61pi", "/studio/x"];
    const moreFroms = [
      "/_astro/x.js",
      "/%5Fx",
      "/a%2Db",
      "/blog/:slug",
      "/[slug]",
      "/a*",
      "/old#x",
      "/old?x=1",
      "/a//b",
      "/a/../b",
      "/%2Fx",
      "/über",
      "about",
    ];
    const tos = [
      "/",
      "/new",
      "/new/",
      "/caf%C3%A9",
      "/#contact",
      "/about#team",
      "/new?ref=old#x",
      "/#",
      "/?",
      "/a#b#c",
      "/a#<x>",
    ];
    const moreTos = [
      "/a//b",
      "/new?a=1?b=2",
      "/new?next=//evil.example",
      "/new?x=<y>",
      "//evil.example",
      "/\\evil",
      "/%5Cevil",
      "/:slug",
    ];

    for (const from of [...froms, ...moreFroms]) {
      for (const to of [...tos, ...moreTos]) {
        const studioRefuses =
          redirectFromProblem(from, studioRules) !== null ||
          redirectToProblem(to, from, studioRules) !== null ||
          redirectLoops(from, to);

        assert.equal(studioRefuses, refused(from, to), `${from} -> ${to}`);
      }
    }
  });
});

describe("toConfigRedirects", () => {
  it("keeps valid entries, maps 302 and defaults the rest to 301, and drops everything else", () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      const result = toConfigRedirects(
        [
          { from: "/about", to: "/about-us", statusCode: 301 },
          { from: "/old", to: "/new", statusCode: 302 },
          { from: "/legacy", to: "/current" },
          { from: "/studio", to: "/x" },
          { from: "/old-page", to: "//evil.example" },
          { from: "/blog/[slug]", to: "/articles/[slug]" },
          { from: "/contact", to: "/contact#form" },
          { from: 1, to: "/x" },
          null,
        ],
        RULES
      );

      assert.deepEqual(result, {
        "/about": { status: 301, destination: "/about-us" },
        "/old": { status: 302, destination: "/new" },
        "/legacy": { status: 301, destination: "/current" },
      });
      assert.equal(errors.length, 6);
    } finally {
      console.error = original;
    }
  });

  it("returns nothing for a missing or malformed list", () => {
    assert.deepEqual(toConfigRedirects(null, RULES), {});
    assert.deepEqual(toConfigRedirects({ from: "/a", to: "/b" }, RULES), {});
  });
});

describe("siteHostsOf", () => {
  it("returns the apex and www hosts whichever one the URL names", () => {
    assert.deepEqual(siteHostsOf("https://www.example.com"), ["example.com", "www.example.com"]);
    assert.deepEqual(siteHostsOf("https://example.com/"), ["example.com", "www.example.com"]);
    assert.deepEqual(siteHostsOf(undefined), []);
    assert.deepEqual(siteHostsOf("not a url"), []);
  });
});
