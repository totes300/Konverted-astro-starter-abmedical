import assert from "node:assert/strict";
import { test } from "node:test";
import { diffKnipReports, emptyKnipReport, formatKnipReport, hasRemovable, isEmptyReport, parseKnipReport } from "./knip";

const REPORT = JSON.stringify({
  issues: [
    { file: "components/chip.tsx", files: [{ name: "components/chip.tsx" }], dependencies: [], devDependencies: [] },
    {
      file: "package.json",
      files: [{ name: "features/blog/format-date.ts" }],
      dependencies: [{ name: "resend", line: 1, col: 1 }],
    },
    { file: "package.json", files: [], devDependencies: [{ name: "lint-staged", line: 2, col: 1 }] },
    {
      file: "features/page-builder/queries.ts",
      exports: [{ name: "CtaSectionQ", line: 3, col: 14 }],
      types: [{ name: "CtaSectionQResult", line: 9, col: 13 }],
    },
  ],
});

test("parseKnipReport reads unused files, packages, exports and types out of the issue list", () => {
  assert.deepEqual(parseKnipReport(REPORT), {
    files: ["components/chip.tsx", "features/blog/format-date.ts"],
    dependencies: ["resend"],
    devDependencies: ["lint-staged"],
    exports: ["features/page-builder/queries.ts: CtaSectionQ"],
    types: ["features/page-builder/queries.ts: CtaSectionQResult"],
  });
});

test("parseKnipReport answers an empty report rather than throwing on an unexpected payload", () => {
  const empty = emptyKnipReport();

  assert.deepEqual(parseKnipReport("not json"), empty);
  assert.deepEqual(parseKnipReport("{}"), empty);
  assert.ok(isEmptyReport(parseKnipReport("{}")));
});

test("diffKnipReports keeps only what became unused, not the superset knip always sees", () => {
  const before = {
    ...emptyKnipReport(),
    files: ["components/chip.tsx"],
    devDependencies: ["lint-staged"],
    exports: ["lib/utils.ts: wait"],
  };
  const after = {
    files: ["components/chip.tsx", "features/blog/format-date.ts"],
    dependencies: ["resend"],
    devDependencies: ["lint-staged"],
    exports: ["lib/utils.ts: wait", "features/page-builder/queries.ts: CtaSectionQ"],
    types: [],
  };

  assert.deepEqual(diffKnipReports(before, after), {
    files: ["features/blog/format-date.ts"],
    dependencies: ["resend"],
    devDependencies: [],
    exports: ["features/page-builder/queries.ts: CtaSectionQ"],
    types: [],
  });
});

test("diffKnipReports is empty when the trim orphaned nothing new", () => {
  const same = { ...emptyKnipReport(), files: ["a.ts"], dependencies: ["b"], exports: ["c.ts: d"] };

  assert.ok(isEmptyReport(diffKnipReports(same, same)));
});

test("a report of exports alone is not empty, but offers nothing to delete outright", () => {
  const report = { ...emptyKnipReport(), exports: ["queries.ts: CtaSectionQ"] };

  assert.ok(!isEmptyReport(report));
  assert.ok(!hasRemovable(report));
});

test("formatKnipReport says so plainly when the trim orphaned nothing", () => {
  assert.match(formatKnipReport(emptyKnipReport()).join("\n"), /nothing that the trim newly orphaned/);
});

test("formatKnipReport lists files, packages and exports under their own headings", () => {
  const lines = formatKnipReport({
    files: ["a.ts"],
    dependencies: ["resend"],
    devDependencies: ["knip"],
    exports: ["q.ts: CtaSectionQ"],
    types: [],
  }).join("\n");

  assert.match(lines, /Files \(1\):\n {6}- a\.ts/);
  assert.match(lines, /Packages \(2\):\n {6}- resend\n {6}- knip/);
  assert.match(lines, /Exports nothing uses any more \(1\), to remove by hand:\n {6}- q\.ts: CtaSectionQ/);
});
