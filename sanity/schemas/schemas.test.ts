import assert from "node:assert/strict";
import { before, test } from "node:test";

// Media fields pull in Studio inputs that read the API version from `sanity/config.ts`, which requires
// its env on import. Placeholders only where the environment has no value; imported once they are set.
const PLACEHOLDER_ENV: Record<string, string> = {
  SANITY_STUDIO_PROJECT_ID: "test-project",
  SANITY_STUDIO_DATASET: "test",
  SANITY_STUDIO_SITE_URL: "https://example.com",
  SANITY_STUDIO_API_VERSION: "2099-01-31",
  NEXT_PUBLIC_SANITY_PROJECT_ID: "test-project",
  NEXT_PUBLIC_SANITY_DATASET: "test",
  NEXT_PUBLIC_SANITY_API_VERSION: "2099-01-31",
  NEXT_PUBLIC_SANITY_STUDIO_BASE_PATH: "/studio",
};

for (const [name, value] of Object.entries(PLACEHOLDER_ENV)) {
  process.env[name] ??= value;
}

let redirect: typeof import("./documents/redirect").redirect;
let mediaPreviewSelect: typeof import("./fields/create-media").mediaPreviewSelect;
let createUriField: typeof import("./fields/create-uri-field").createUriField;
let site: typeof import("./documents/site").site;

before(async () => {
  ({ redirect } = await import("./documents/redirect"));
  ({ mediaPreviewSelect } = await import("./fields/create-media"));
  ({ createUriField } = await import("./fields/create-uri-field"));
  ({ site } = await import("./documents/site"));
});

type CustomValidator = (value: unknown, context: { parent?: unknown }) => true | string;

/** Captures the callback a field's `validation` passes to `Rule.custom`, mocking the rule chain. */
function captureFieldValidator(fieldName: string): CustomValidator {
  const field = (redirect.fields as Array<{ name: string; validation?: unknown }>).find((f) => f.name === fieldName);
  assert.ok(field?.validation, `field ${fieldName} has no validation`);

  let captured: CustomValidator | undefined;
  const rule = {
    required() {
      return this;
    },
    custom(fn: CustomValidator) {
      captured = fn;
      return this;
    },
  };

  (field.validation as (rule: unknown) => unknown)(rule);
  assert.ok(captured, `field ${fieldName} never called Rule.custom`);
  return captured;
}

test("redirect: from/to require a leading slash and reject paths that name the same page", () => {
  const loops =
    'The "From" and "To" paths name the same page (letter case, an anchor, a query or a trailing "/" does not change it), so the redirect would loop.';

  for (const [fieldName, otherField] of [
    ["from", "to"],
    ["to", "from"],
  ] as const) {
    const validate = captureFieldValidator(fieldName);

    assert.equal(validate(undefined, {}), true, `${fieldName}: empty is left to required()`);
    assert.equal(validate("about", {}), 'Path must start with a "/" (e.g., "/about").');
    assert.equal(validate("/same", { parent: { [otherField]: "/same" } }), loops);
    assert.equal(validate("/same/", { parent: { [otherField]: "/same" } }), loops);
    assert.equal(validate("/old-page", { parent: { [otherField]: "/new-page" } }), true);
  }
});

test("mediaPreviewSelect: bare and prefixed select maps", () => {
  assert.deepEqual(mediaPreviewSelect(), {
    type: "type",
    image: "image",
    playbackId: "video.asset.playbackId",
    thumbTime: "video.asset.thumbTime",
    videoCoverUrl: "videoCover.asset.url",
  });

  assert.deepEqual(mediaPreviewSelect("appMedia"), {
    type: "appMedia.type",
    image: "appMedia.image",
    playbackId: "appMedia.video.asset.playbackId",
    thumbTime: "appMedia.video.asset.thumbTime",
    videoCoverUrl: "appMedia.videoCover.asset.url",
  });
});

type Level = "error" | "warning";

/** Runs every `Rule.custom` callback a `validation` registers, and lists the level of each one that fails. */
function failures(validation: unknown, value: unknown, context: object): Level[] {
  const custom: Array<{ validate: (value: unknown, context: object) => unknown; level: Level }> = [];
  const rule = {
    required: () => rule,
    custom(validate: (value: unknown, context: object) => unknown) {
      const entry = { validate, level: "error" as Level };
      custom.push(entry);

      return {
        ...rule,
        warning() {
          entry.level = "warning";
          return rule;
        },
      };
    },
  };

  (validation as (rule: unknown) => unknown)(rule);

  return custom.flatMap(({ validate, level }) => (validate(value, context) === true ? [] : [level]));
}

test("uri: a path the Studio, the not-found page or the section preview holds is refused, sub-paths included", () => {
  const validation = createUriField({ source: "title" }).validation;
  const at = (uri: string) => failures(validation, { current: uri }, { document: { _id: "doc-1", _type: "page" } });

  for (const uri of ["/studio", "/studio/pricing", "/404", "/section-preview", "/section-preview/x"]) {
    assert.deepEqual(at(uri), ["error"], uri);
  }

  for (const uri of ["/studios", "/4040", "/section-previews", "/about"]) {
    assert.deepEqual(at(uri), [], uri);
  }
});

test("uri: the article and author routes keep their paths, and serve an article or a person only there", () => {
  const validation = createUriField({ source: "title" }).validation;
  const at = (uri: string, _type = "page") => failures(validation, { current: uri }, { document: { _id: "doc-1", _type } });

  for (const uri of ["/blog/foo", "/blog/authors", "/blog/authors/jane", "/blog/authors/jane/modal"]) {
    assert.deepEqual(at(uri), ["error"], uri);
  }

  for (const uri of ["/blogs/foo", "/blog/foo/bar", "/blog/authors/jane/cv", "/blog/authors/jane/modal/x"]) {
    assert.deepEqual(at(uri), [], uri);
  }

  assert.deepEqual(at("/blog/launch", "article"), []);
  assert.deepEqual(at("/blog/authors/jane", "person"), []);

  for (const uri of ["/launch", "/blog/launch/extra", "/blog/authors/jane", "/studio/launch"]) {
    assert.deepEqual(at(uri, "article"), ["error"], uri);
  }

  for (const uri of ["/jane", "/blog/jane", "/blog/authors", "/blog/authors/jane/extra"]) {
    assert.deepEqual(at(uri, "person"), ["error"], uri);
  }
});

test("seo: the Site singleton's No Index says it marks every page, not that it hides pages from the lists", () => {
  const seo = (site.fields as Array<{ name: string; fields?: Array<{ name: string; description?: string }> }>).find(
    (field) => field.name === "seoMetadata"
  );
  const description = seo?.fields?.find((field) => field.name === "noIndex")?.description ?? "";

  assert.match(description, /every page/);
  assert.doesNotMatch(description, /Keep this page out/);
});
