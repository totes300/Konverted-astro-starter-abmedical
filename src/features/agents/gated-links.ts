// Stored Markdown (`/llms.txt`, a page's agent Markdown) is a snapshot from generation time, so links to
// pages protected or `noIndex` since then are dropped when it is served.

import { canonicalUri } from "~/features/auth/canonical-path";
import { joinSiteUrl, siteHosts } from "~/lib/site-url";

// Read off the destination, never the text (any brackets, a soft break); a raw URL keeps balanced parentheses, as `/a(1)`.
const LINK_DESTINATION = /\]\(\s*(?:<([^<>\s]*)>|((?:[^\s()]|\([^\s()]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;
// Autolinks and bare URLs name a page with no link syntax; trailing punctuation is prose, a balanced `(1)` is not.
const ABSOLUTE_URL = /\bhttps?:\/\/(?:[^\s<>()[\]"'`]|\([^\s<>()[\]"'`]*\))*(?:[^\s<>()[\]"'`.,;:!?]|\([^\s<>()[\]"'`]*\))/gi;
const AUTOLINK = /<(https?:\/\/[^\s<>]+)>/gi;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:/;
const REFERENCE_DESTINATION = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^<>\n]*)>|(\S+))/;
const DEFINITION_TITLE = /^\s*(?:"[^"]*"|'[^']*'|\([^()]*\))\s*$/;

// Every spelling of one page (encoded, doubled slashes, trailing slash) lands on its stored `uri.current`.
function canonicalPath(pathname: string): string {
  let decoded = pathname;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape is matched as written.
  }

  return canonicalUri(decoded.replace(/\/{2,}/g, "/"));
}

/** The page a link names on this site, whichever scheme or apex/`www` twin it is written with; null off the site. */
function linkedSitePath(href: string, site: URL): string | null {
  if (href.startsWith("#")) {
    return null;
  }

  try {
    const url = new URL(href, site);
    const isSite =
      (url.protocol === "https:" || url.protocol === "http:") &&
      siteHosts(site.href).includes(url.hostname) &&
      url.port === site.port;

    return isSite ? canonicalPath(url.pathname) : null;
  } catch {
    return null;
  }
}

/** A definition runs on only for a destination left to the next line or a title on a line of its own; prose after it is a paragraph. */
function continuesDefinition(block: string[], line: string): boolean {
  const awaitsDestination = block.length === 1 && /\]:\s*$/.test(block[0] ?? "");

  return (awaitsDestination && !REFERENCE_DEFINITION.test(line)) || DEFINITION_TITLE.test(line);
}

/** A list item or a paragraph with the lines it wraps onto, a reference definition, a heading, or a blank line: what a Markdown reader treats as one. */
function toBlocks(markdown: string): string[][] {
  const blocks: string[][] = [];

  for (const line of markdown.split("\n")) {
    const current = blocks.at(-1);
    const continues =
      current !== undefined &&
      line.trim() !== "" &&
      (REFERENCE_DEFINITION.test(current[0])
        ? continuesDefinition(current, line)
        : current[0].trim() !== "" &&
          !HEADING.test(current[0]) &&
          !LIST_ITEM.test(line) &&
          !HEADING.test(line) &&
          !REFERENCE_DEFINITION.test(line));

    if (continues) {
      current.push(line);
    } else {
      blocks.push([line]);
    }
  }

  return blocks;
}

/** The `[` that opens the link text ending at `close`, skipping balanced and escaped brackets; -1 when there is none. */
function openingBracket(text: string, close: number): number {
  let depth = 0;

  for (let index = close - 1; index >= 0; index--) {
    if (text[index - 1] === "\\") {
      continue;
    }

    if (text[index] === "]") {
      depth++;
    } else if (text[index] === "[") {
      if (depth === 0) {
        return index;
      }

      depth--;
    }
  }

  return -1;
}

function destinationOf(match: RegExpMatchArray): string {
  return match[1] ?? match[2] ?? "";
}

/** Every destination a block names: its inline links, the URLs written out in it, and a reference definition's target. */
function destinationsOf(text: string): string[] {
  const definition = REFERENCE_DESTINATION.exec(text);

  return [
    ...[...text.matchAll(LINK_DESTINATION)].map(destinationOf),
    ...(text.match(ABSOLUTE_URL) ?? []),
    ...(definition ? [destinationOf(definition)] : []),
  ];
}

/** Keeps a gated link's words and drops its destination; a gated URL written out as text goes entirely. */
function unlinkGated(text: string, isGated: (href: string) => boolean): string {
  const gatedLinks = [...text.matchAll(LINK_DESTINATION)].filter((match) => isGated(destinationOf(match)));
  let out = text;

  // Right to left, so each cut leaves the positions of the ones before it intact.
  for (const match of gatedLinks.reverse()) {
    const close = match.index;
    const end = close + match[0].length;
    const open = openingBracket(out, close);

    if (open === -1) {
      out = out.slice(0, close + 1) + out.slice(end);
    } else {
      const start = out[open - 1] === "!" ? open - 1 : open;

      out = out.slice(0, start) + out.slice(open + 1, close) + out.slice(end);
    }
  }

  return out
    .replace(AUTOLINK, (autolink, href: string) => (isGated(href) ? "" : autolink))
    .replace(ABSOLUTE_URL, (href) => (isGated(href) ? "" : href));
}

/** Drops a list item or reference that names a gated page and unlinks one anywhere else; every other link is kept. */
export function dropGatedLinks(markdown: string, gatedPaths: ReadonlySet<string>, siteUrl: string): string {
  if (gatedPaths.size === 0) {
    return markdown;
  }

  const site = new URL(joinSiteUrl(siteUrl));
  const isGated = (href: string) => {
    const path = linkedSitePath(href, site);

    return path !== null && gatedPaths.has(path);
  };

  return toBlocks(markdown)
    .flatMap((block) => {
      const text = block.join("\n");

      if (!destinationsOf(text).some(isGated)) {
        return block;
      }

      if (LIST_ITEM.test(block[0]) || REFERENCE_DEFINITION.test(block[0])) {
        return [];
      }

      return unlinkGated(text, isGated).split("\n");
    })
    .join("\n");
}
