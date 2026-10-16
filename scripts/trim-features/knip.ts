/**
 * The second pass: what the manifest did not know about.
 *
 * Knip cannot drive this trim. On a clean tree it finds (near) nothing here, because nothing is
 * statically unreachable: `features/blog/**` is imported by a route entry point, `article.tsx` is an
 * entry in `sanity/schemas/index.ts`. It is also blind to the three things that matter most in this
 * repo — a Sanity schema registry, where an array entry *is* the use; GROQ strings that name `_type`s
 * as plain text; and the dataset. And "this client has no blog" is a product decision, not a static
 * fact about the code.
 *
 * Where it earns its place is here, *after* the manifest has unwired a feature: the shared helper
 * only that feature used, and the dependency that just became unused. That is why it runs as an
 * opt-in stage of this script and is deliberately kept out of `npm run check` — the starter is a
 * superset on purpose (`createIconField` has no call sites by design), so a standing knip gate would
 * fight that on every run.
 */

import { spawnSync } from "node:child_process";

export type KnipReport = {
  files: string[];
  dependencies: string[];
  devDependencies: string[];
  /** Unused exports and types, as `file: name`: a query or helper the trim stopped calling. */
  exports: string[];
  types: string[];
};

type Key = keyof KnipReport;

const KEYS: readonly Key[] = ["files", "dependencies", "devDependencies", "exports", "types"];

/** Knip's `--reporter json` payload, narrowed to the parts this script acts on. */
type RawKnipReport = {
  issues?: ({ file?: string } & Partial<Record<Key, { name: string }[]>>)[];
};

export function emptyKnipReport(): KnipReport {
  return { files: [], dependencies: [], devDependencies: [], exports: [], types: [] };
}

/**
 * Knip's JSON shape has moved between majors, so parse defensively: an unrecognised payload becomes
 * an empty report rather than a crash at the end of an otherwise successful trim.
 */
export function parseKnipReport(stdout: string): KnipReport {
  let raw: RawKnipReport;

  try {
    raw = JSON.parse(stdout) as RawKnipReport;
  } catch {
    return emptyKnipReport();
  }

  const issues = raw.issues ?? [];
  const names = (key: "files" | "dependencies" | "devDependencies") => [
    ...new Set(issues.flatMap((issue) => (issue[key] ?? []).map((entry) => entry.name))),
  ];
  // An export is only meaningful with its file, and lines shift as the trim edits around it.
  const symbols = (key: "exports" | "types") => [
    ...new Set(issues.flatMap((issue) => (issue[key] ?? []).map((entry) => `${issue.file ?? "?"}: ${entry.name}`))),
  ];

  return {
    files: names("files"),
    dependencies: names("dependencies"),
    devDependencies: names("devDependencies"),
    exports: symbols("exports"),
    types: symbols("types"),
  };
}

/**
 * What the trim orphaned, and nothing else.
 *
 * Knip on a clean tree already reports a dozen files here, because the starter is a superset on
 * purpose: `createIconField` and the umami helpers have no call sites by design. Reporting those
 * after every trim would bury the two or three entries that actually became unused. So the sweep is
 * a diff against a baseline taken before the trim ran.
 */
export function diffKnipReports(before: KnipReport, after: KnipReport): KnipReport {
  const added = (key: Key) => {
    const seen = new Set(before[key]);

    return after[key].filter((entry) => !seen.has(entry));
  };

  return Object.fromEntries(KEYS.map((key) => [key, added(key)])) as KnipReport;
}

/** True when knip found nothing worth a second pass. */
export function isEmptyReport(report: KnipReport): boolean {
  return KEYS.every((key) => report[key].length === 0);
}

/** Whether the report names anything the sweep can delete outright, rather than code to edit. */
export function hasRemovable(report: KnipReport): boolean {
  return report.files.length > 0 || report.dependencies.length > 0 || report.devDependencies.length > 0;
}

/** The `🧹 Newly unused` block: only what the trim orphaned, never the superset knip always sees. */
export function formatKnipReport(report: KnipReport): string[] {
  if (isEmptyReport(report)) {
    return ["🧹 knip found nothing that the trim newly orphaned.", ""];
  }

  const lines = ["🧹 Newly unused after the trim (knip)", ""];

  if (report.files.length > 0) {
    lines.push(`   Files (${report.files.length}):`);
    lines.push(...report.files.map((file) => `      - ${file}`));
    lines.push("");
  }

  const packages = [...report.dependencies, ...report.devDependencies];

  if (packages.length > 0) {
    lines.push(`   Packages (${packages.length}):`);
    lines.push(...packages.map((name) => `      - ${name}`));
    lines.push("");
  }

  const symbols = [...report.exports, ...report.types];

  if (symbols.length > 0) {
    lines.push(`   Exports nothing uses any more (${symbols.length}), to remove by hand:`);
    lines.push(...symbols.map((name) => `      - ${name}`));
    lines.push("");
  }

  return lines;
}

const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * Runs knip and returns what it found. Knip exits non-zero *because* it found issues, which is the
 * normal outcome here, so the exit code is only treated as a failure when nothing parseable came
 * back on stdout.
 */
export function runKnip(): { report: KnipReport; error?: string } {
  const result = spawnSync(npxBin, ["knip", "--reporter", "json", "--no-progress"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  if (result.error) {
    return { report: emptyKnipReport(), error: result.error.message };
  }

  const stdout = result.stdout ?? "";

  if (!stdout.trim()) {
    return {
      report: emptyKnipReport(),
      error: (result.stderr ?? "").trim() || `knip exited with code ${result.status} and printed nothing.`,
    };
  }

  return { report: parseKnipReport(stdout) };
}
