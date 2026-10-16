import assert from "node:assert/strict";
import { test } from "node:test";
import { findFeature } from "./features";
import { closingNotes, type RunFacts } from "./notes";

function facts(ids: string[], overrides: Partial<RunFacts> = {}): RunFacts {
  const features = ids.map((id) => {
    const feature = findFeature(id);

    assert.ok(feature, id);

    return feature;
  });

  return {
    features,
    documentTypes: features.flatMap((feature) => feature.documentTypes ?? []),
    sectionTypes: features.flatMap((feature) => feature.sectionTypes ?? []),
    fields: features.flatMap((feature) => feature.fields ?? []),
    purged: false,
    totals: [{ dataset: "production", counts: {} }],
    routedTypes: ["article", "blog", "legalPage", "page", "person"],
    generatedMentions: () => false,
    ...overrides,
  };
}

test("a run whose content is all empty gets no dataset, sitemap or agent Markdown notes", () => {
  const notes = closingNotes(facts(["section:cta", "section:text"]));

  assert.deepEqual(notes, []);
});

test("routed documents left behind name the sitemap, and only routed types are named", () => {
  const notes = closingNotes(
    facts(["contact-form", "legal-pages"], {
      totals: [{ dataset: "production", counts: { legalPage: 2, contactFormSubmission: 4 } }],
    })
  ).join("\n");

  assert.match(notes, /still holds `legalPage` documents, and .*sitemap/);
  assert.doesNotMatch(notes, /`contactFormSubmission` documents/);
  assert.match(notes, /run `npm run trim` again/);
});

test("non-routed content still earns the come-back-later note, without the sitemap one", () => {
  const notes = closingNotes(
    facts(["contact-form"], { totals: [{ dataset: "production", counts: { contactFormSubmission: 4 } }] })
  ).join("\n");

  assert.doesNotMatch(notes, /sitemap/);
  assert.match(notes, /run `npm run trim` again/);
});

test("a field still set is content left behind", () => {
  const notes = closingNotes(
    facts(["contact-form"], {
      totals: [{ dataset: "production", counts: { "siteSettings.contactFormNotificationEmails": 1 } }],
    })
  ).join("\n");

  assert.match(notes, /run `npm run trim` again/);
});

test("unread datasets keep every content note, since nothing shows the content is gone", () => {
  const notes = closingNotes(facts(["blog"], { totals: [] })).join("\n");

  assert.match(notes, /may still hold `article`, `blog` documents/);
  assert.match(notes, /regenerate them from the Agents tab/);
});

test("a purge in the same run drops the come-back-later notes but keeps the agent Markdown one", () => {
  const notes = closingNotes(
    facts(["section:media"], { purged: true, totals: [{ dataset: "production", counts: { mediaSectionField: 1 } }] })
  ).join("\n");

  assert.doesNotMatch(notes, /npm run trim` again/);
  assert.match(notes, /regenerate them from the Agents tab/);
  assert.match(notes, /sectionTarget/);
});

test("the thumbnail note names only the sections that declare none", () => {
  const notes = closingNotes(facts(["section:contact-form", "section:cta"])).join("\n");

  assert.match(notes, /`section:contact-form` declares no thumbnail/);
  assert.doesNotMatch(notes, /`section:cta`/);
});

test("generated Markdown naming the feature earns the regenerate note on its own", () => {
  let asked = 0;
  const notes = closingNotes(
    facts(["contact-form"], {
      generatedMentions: () => {
        asked += 1;
        return true;
      },
    })
  );

  assert.equal(asked, 1);
  assert.ok(notes.some((note) => note.includes("Agents tab")));
});
