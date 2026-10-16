/**
 * Prose that still describes a removed feature. The trim prunes links to a deleted doc, but a skill or
 * doc that explains the feature in passing is a sentence to rewrite, so it is listed rather than edited.
 */

import { apiRouteOf, type Feature } from "./features";

export type Mention = { file: string; line: number; term: string };

/** A file the feature deletes, read before it goes: its name and its exports become search terms. */
export type DeletedFile = { path: string; text: string };

const EXTENSION = /(?:\.(?:test|spec))?\.(?:d\.ts|ts|tsx|mts|mjs|js|jsx|astro|jpg|png|svg|json|css)$/;
const DECLARED_EXPORT =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

/**
 * A line pointing at the trim's own doc, which names every feature it can remove. Skipped wherever it
 * appears, so the README bullet advertising the trim is not reported as describing the contact form.
 */
const ABOUT_THE_TRIM = /trimming-features/;

/** A name distinctive enough to search prose for: compound, never a word like `Form` or `blog`. */
function isDistinctive(name: string): boolean {
  return /[-._]/.test(name) || /[a-z][A-Z]/.test(name);
}

function basename(path: string): string {
  return (path.split("/").pop() ?? "").replace(EXTENSION, "");
}

/** Every name a module exports, declared inline or listed in an `export { … }` clause. */
export function exportedNames(source: string): string[] {
  const declared = [...source.matchAll(DECLARED_EXPORT)].map((match) => match[1] ?? "");
  const listed = [...source.matchAll(EXPORT_LIST)].flatMap((match) =>
    (match[1] ?? "").split(",").map((entry) => (entry.split(/\s+as\s+/).pop() ?? "").trim().replace(/^type\s+/, ""))
  );

  return [...declared, ...listed].filter((name) => name && name !== "default");
}

/** `spam-prevention` is also written `spam prevention` in prose. */
function spacedForm(term: string): string[] {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(term) ? [term.replaceAll("-", " ")] : [];
}

/**
 * What prose describing a feature would say: the names of its paths and of every file inside them,
 * the distinctive names those files export, the API routes it serves, its stored types and fields,
 * its env vars, and the prose names it declares.
 *
 * `files` is every file the feature deletes, read before the trim runs. Without it only the top-level
 * paths count, which misses `ContactFormElement` inside a section folder and every export of a layer.
 */
export function mentionTerms(feature: Feature, files: readonly DeletedFile[] = []): string[] {
  const paths = [...feature.paths, ...files.map((file) => file.path)];
  const names = [...paths.map(basename), ...files.flatMap((file) => exportedNames(file.text))].filter(isDistinctive);
  const routes = paths.map(apiRouteOf).filter((route): route is string => Boolean(route));
  const types = [...(feature.documentTypes ?? []), ...(feature.sectionTypes ?? [])].map((type) => `\`${type}\``);
  const fields = (feature.fields ?? []).map((field) => field.name);
  const terms = [...names, ...routes, ...types, ...fields, ...(feature.env ?? []), ...(feature.mentions ?? [])];

  return [...new Set([...terms, ...terms.flatMap(spacedForm)])];
}

/** Every line naming a term, first term per line, case-insensitive for the prose names. */
export function findMentions(files: { path: string; text: string }[], terms: readonly string[]): Mention[] {
  const found: Mention[] = [];
  const lowered = terms.map((term) => ({ term, lower: term.toLowerCase() }));

  for (const { path, text } of files) {
    text.split("\n").forEach((line, index) => {
      if (ABOUT_THE_TRIM.test(line)) {
        return;
      }

      const lower = line.toLowerCase();
      const match = lowered.find((candidate) => lower.includes(candidate.lower));

      if (match) {
        found.push({ file: path, line: index + 1, term: match.term });
      }
    });
  }

  return found;
}

/** One line per file: the file, then the line numbers, so a long list stays scannable. */
export function formatMentions(mentions: readonly Mention[]): string[] {
  const byFile = new Map<string, number[]>();

  for (const { file, line } of mentions) {
    byFile.set(file, [...(byFile.get(file) ?? []), line]);
  }

  return [...byFile].map(([file, lines]) => `${file}:${lines.join(",")}`);
}
