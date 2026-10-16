import assert from "node:assert/strict";
import { test } from "node:test";
import { frameAncestors, reportOnlyPolicy, securityHeaders } from "./security-headers";

const BASE = { siteUrl: "https://example.com", sanityProjectId: "abc123", isDev: false, isVercelPreview: false };

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((entry) => {
      const [name = "", ...sources] = entry.split(" ");
      return [name, sources];
    })
  );
}

test("frame-ancestors lists the site's apex and www twin with its protocol", () => {
  assert.equal(frameAncestors("https://example.com"), "'self' https://example.com https://www.example.com");
  assert.equal(frameAncestors("https://www.example.com"), "'self' https://example.com https://www.example.com");
  assert.equal(frameAncestors("http://localhost:4321"), "'self' http://localhost:4321 http://www.localhost:4321");
});

test("frame protection is enforced on every route, the full policy is report-only", () => {
  const headers = new Map(securityHeaders(BASE).always);

  assert.equal(headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.equal(headers.get("Content-Security-Policy"), "frame-ancestors 'self' https://example.com https://www.example.com");
  assert.equal(headers.has("Content-Security-Policy-Report-Only"), false);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
});

test("the report-only policy locks down plugins, base and forms and lists the inventory", () => {
  const policy = directives(reportOnlyPolicy(BASE));

  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'self'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"]);
  assert.deepEqual(policy.get("script-src"), ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://cloud.umami.is"]);
  assert.ok(policy.get("img-src")?.includes("https://cdn.sanity.io"));
  assert.ok(policy.get("connect-src")?.includes("wss://abc123.api.sanity.io"));
  assert.ok(policy.get("connect-src")?.includes("https://unpkg.com"));
  assert.equal(policy.has("frame-ancestors"), false, "frame-ancestors only works in an enforced policy");
  assert.equal(reportOnlyPolicy(BASE).includes("vercel.live"), false);
});

test("the Vercel toolbar origins appear on preview deployments only", () => {
  const policy = directives(reportOnlyPolicy({ ...BASE, isVercelPreview: true }));

  assert.ok(policy.get("script-src")?.includes("https://vercel.live"));
  assert.ok(policy.get("connect-src")?.includes("wss://ws-us3.pusher.com"));
});

test("no source is listed twice in a directive", () => {
  for (const [name, sources] of directives(reportOnlyPolicy({ ...BASE, isDev: true, isVercelPreview: true }))) {
    assert.equal(new Set(sources).size, sources.length, name);
  }
});
