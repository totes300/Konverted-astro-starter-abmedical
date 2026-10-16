import assert from "node:assert/strict";
import { test } from "node:test";
import { isScreenshotAssetUrl, readCappedBody, screenshotExtension, screenshotTargetUrl } from "./screenshot-checks";

const SITE = "https://example.com";

test("an https page on the site's own hosts is accepted and normalized", () => {
  assert.equal(screenshotTargetUrl("https://example.com/work/a?x=1", SITE)?.href, "https://example.com/work/a?x=1");
  assert.equal(screenshotTargetUrl("  https://www.example.com/  ", SITE)?.href, "https://www.example.com/");
  assert.equal(screenshotTargetUrl("https://EXAMPLE.com/", "https://www.example.com")?.hostname, "example.com");
});

test("other schemes, hosts, ports and credentials are refused", () => {
  const refused = [
    "http://example.com/",
    "https://example.com:8443/",
    "https://user:pass@example.com/",
    "https://evil.com/",
    "https://example.com.evil.com/",
    "https://evilexample.com/",
    "https://sub.example.com/",
    "https://example.com./",
    "https://169.254.169.254/latest/meta-data/",
    "http://localhost:4321/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "//example.com/",
    "/relative",
    "https://\texample.com/",
    "https://exam\nple.com/",
    "https://example.com/a\r\nb",
    "https:\\\\example.com\\@evil.com/",
    `https://example.com/${"a".repeat(3000)}`,
    "",
    "not a url",
  ];

  for (const value of refused) {
    assert.equal(screenshotTargetUrl(value, SITE), null, value);
  }

  assert.equal(screenshotTargetUrl(42, SITE), null);
  assert.equal(screenshotTargetUrl(null, SITE), null);
});

test("a local site URL accepts nothing, since the provider cannot reach it", () => {
  assert.equal(screenshotTargetUrl("http://localhost:4321/", "http://localhost:4321"), null);
  assert.equal(screenshotTargetUrl("https://localhost/", "http://localhost:4321"), null);
  assert.equal(screenshotTargetUrl("https://example.com/", "http://localhost:4321"), null);
});

test("the screenshot download is pinned to the provider's https asset domain", () => {
  assert.equal(isScreenshotAssetUrl("https://iad.microlink.io/abc.jpeg"), true);
  assert.equal(isScreenshotAssetUrl("https://microlink.io/abc.png"), true);

  for (const value of [
    "http://iad.microlink.io/abc.jpeg",
    "https://iad.microlink.io:444/abc.jpeg",
    "https://user@iad.microlink.io/abc.jpeg",
    "https://microlink.io.evil.com/abc.jpeg",
    "https://evilmicrolink.io/abc.jpeg",
    "https://169.254.169.254/latest/meta-data/",
    "https://example.com/abc.jpeg",
    "not a url",
    undefined,
  ]) {
    assert.equal(isScreenshotAssetUrl(value), false, String(value));
  }
});

test("only JPEG and PNG content types are accepted", () => {
  assert.equal(screenshotExtension("image/jpeg"), "jpg");
  assert.equal(screenshotExtension("image/PNG; charset=binary"), "png");

  for (const value of ["text/html", "image/svg+xml", "application/octet-stream", "", null]) {
    assert.equal(screenshotExtension(value), null, String(value));
  }
});

test("a body over the cap is refused, by declared length or while streaming", async () => {
  assert.deepEqual(await readCappedBody(new Response(new Uint8Array([1, 2, 3])), 3), new Uint8Array([1, 2, 3]));
  assert.equal(await readCappedBody(new Response(new Uint8Array(4)), 3), null);
  assert.equal(await readCappedBody(new Response(new Uint8Array(1), { headers: { "content-length": "99999999" } }), 3), null);

  const chunked = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(2));
      controller.enqueue(new Uint8Array(2));
      controller.close();
    },
  });

  assert.equal(await readCappedBody(new Response(chunked), 3), null);
});

test("an empty body reads as zero bytes, which the route refuses", async () => {
  assert.equal((await readCappedBody(new Response(null), 3))?.byteLength, 0);
});
