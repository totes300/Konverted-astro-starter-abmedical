/**
 * The closing "Left for a human" list. Each note is printed only when its condition holds for this
 * run, because a list that never changes stops being read.
 */

import { type Feature, lacksThumbnail, STRANDED_ROUTE_EFFECT, type StoredField, THUMBNAILS_DIR } from "./features";
import { fieldLabel } from "./schema";

export type RunFacts = {
  features: readonly Feature[];
  documentTypes: readonly string[];
  sectionTypes: readonly string[];
  fields: readonly StoredField[];
  /** Whether this run purged the dataset itself. */
  purged: boolean;
  /** Per dataset read before the run, counts keyed by type or `fieldLabel`. Empty when none was read. */
  totals: readonly { dataset: string; counts: Record<string, number> }[];
  /** Document types the extracted schema gave a `uri`, read before the run. */
  routedTypes: readonly string[];
  /** Whether stored agent Markdown or llms.txt names the feature. Only asked when nothing cheaper settles it. */
  generatedMentions: () => boolean;
};

function quoted(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

export function closingNotes(facts: RunFacts): string[] {
  const known = facts.totals.length > 0;
  // Unknown counts are treated as content: an unread dataset is no evidence that nothing is there.
  const held = (key: string) => !known || facts.totals.some((entry) => (entry.counts[key] ?? 0) > 0);
  const routed = facts.documentTypes.filter((type) => facts.routedTypes.includes(type) && held(type));
  const sections = facts.sectionTypes.filter(held);
  const fields = facts.fields.map(fieldLabel).filter(held);
  const leftBehind = facts.documentTypes.some(held) || sections.length > 0 || fields.length > 0;
  const notes: string[] = [];

  if (!facts.purged && routed.length > 0) {
    notes.push(
      `The dataset ${known ? "still holds" : "may still hold"} ${quoted(routed)} documents, and ${STRANDED_ROUTE_EFFECT}`
    );
  }

  if (!facts.purged && leftBehind) {
    notes.push(
      "Once this is deployed, run `npm run trim` again: it finds the content this left behind and offers to delete it. It compares the extracted schema against each dataset, so it needs nothing from this run."
    );
  }

  const unphotographed = facts.features.filter(lacksThumbnail).map((feature) => feature.id);

  if (unphotographed.length > 0) {
    notes.push(
      `${quoted(unphotographed)} ${unphotographed.length === 1 ? "declares" : "declare"} no thumbnail, so if this project captured one, delete it from \`${THUMBNAILS_DIR}/\` and its \`manifest.json\` by hand.`
    );
  }

  if (!known || routed.length > 0 || sections.length > 0 || facts.generatedMentions()) {
    notes.push(
      "Generated `agentMarkdown.content` and `siteSettings.llms.content` still describe the old content; regenerate them from the Agents tab."
    );
  }

  if (sections.length > 0) {
    notes.push(
      "A `sectionTarget` anchor written inside a rich text annotation is not reachable by GROQ, so the anchor report is a floor, not a guarantee."
    );
  }

  return notes;
}
