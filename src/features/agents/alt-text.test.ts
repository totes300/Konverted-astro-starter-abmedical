import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDescriptionSourceUrl, isDescribableAsset, isImageAssetId, MAX_ALT_TEXT_LENGTH, normalizeAltText } from "./alt-text";

describe("normalizeAltText", () => {
  it("keeps a clean description untouched", () => {
    assert.equal(
      normalizeAltText("Sanity Studio showing a nested structure list resolving into a second pane"),
      "Sanity Studio showing a nested structure list resolving into a second pane"
    );
  });

  it("keeps quoted text inside the description", () => {
    assert.equal(
      normalizeAltText("Certificate reading “Site of the Day. Aug 02, 2026”"),
      "Certificate reading “Site of the Day. Aug 02, 2026”"
    );
  });

  it("unwraps a fully quoted line", () => {
    assert.equal(normalizeAltText('"Portrait of a woman carrying a basket"'), "Portrait of a woman carrying a basket");
    assert.equal(normalizeAltText("“Portrait of a woman carrying a basket”"), "Portrait of a woman carrying a basket");
  });

  it("drops openers that only restate the medium", () => {
    assert.equal(normalizeAltText("Image of a red bicycle leaning on a wall"), "A red bicycle leaning on a wall");
    assert.equal(normalizeAltText("This image shows a red bicycle"), "A red bicycle");
  });

  it("keeps openers that carry information", () => {
    assert.equal(normalizeAltText("Film still of a man in a tweed jacket"), "Film still of a man in a tweed jacket");
    assert.equal(normalizeAltText("Screenshot of the awards page"), "Screenshot of the awards page");
  });

  it("takes the first non-empty line and drops the trailing period", () => {
    assert.equal(normalizeAltText("\n  A red bicycle.\n\nLet me know if you want another version."), "A red bicycle");
  });

  it("truncates at a word boundary without leaving punctuation dangling", () => {
    const result = normalizeAltText(`${"word ".repeat(60)}tail`);

    assert.ok(result.length <= MAX_ALT_TEXT_LENGTH);
    assert.ok(!result.endsWith(" "));
    assert.equal(result.slice(-1), "d");
  });

  it("returns an empty string when there is nothing usable", () => {
    assert.equal(normalizeAltText("   \n  "), "");
    assert.equal(normalizeAltText('""'), "");
  });
});

describe("buildDescriptionSourceUrl", () => {
  it("caps the source image so a full-size original never reaches the model", () => {
    const url = new URL(buildDescriptionSourceUrl("https://cdn.sanity.io/images/p/production/abc-3840x2160.png"));

    assert.equal(url.searchParams.get("w"), "1024");
    assert.equal(url.searchParams.get("fit"), "max");
    assert.equal(url.searchParams.get("fm"), "jpg");
  });
});

describe("isDescribableAsset", () => {
  it("accepts raster assets served over https", () => {
    assert.equal(isDescribableAsset({ url: "https://cdn.sanity.io/a.png", extension: "png" }), true);
  });

  it("rejects svgs and assets with no url", () => {
    assert.equal(isDescribableAsset({ url: "https://cdn.sanity.io/a.svg", extension: "svg" }), false);
    assert.equal(isDescribableAsset({ url: "https://cdn.sanity.io/a.svg", extension: "SVG" }), false);
    assert.equal(isDescribableAsset({ url: undefined, extension: "png" }), false);
  });
});

describe("isImageAssetId", () => {
  it("accepts the ids Sanity gives image assets", () => {
    assert.equal(isImageAssetId("image-a3f9c1e2b4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a9-3840x2160-png"), true);
    assert.equal(isImageAssetId("image-Tb9Ew8CXIwaY6R1kjMvI0uRR-2000x3000-jpg"), true);
  });

  it("refuses anything else before a read or a patch could use it", () => {
    for (const value of [
      undefined,
      42,
      "",
      "drafts.image-abc-1x1-png",
      "file-abc-pdf",
      "siteSettings",
      "image-abc-1x1-png\n",
      "image-abc-1x1-png*",
      "image-../x-1x1-png",
      `image-${"a".repeat(200)}-1x1-png`,
    ]) {
      assert.equal(isImageAssetId(value), false, JSON.stringify(value));
    }
  });
});
