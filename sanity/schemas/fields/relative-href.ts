// The URL Params link is stored as a raw string and rendered as an `href`, so only a same-site relative form may be saved.

/** Why this value cannot be a relative link on this site, or null when it can. */
export function relativeHrefProblem(href: string): string | null {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers strip these while parsing, which is how a scheme hides.
  if (/[\s\u0000-\u001f\u007f]/.test(href)) {
    return "Remove the spaces and line breaks: a link with whitespace is not a stable address.";
  }

  if (href.includes("\\")) {
    return "Use forward slashes only: browsers read a backslash as a slash, which can point the link at another site.";
  }

  if (href.startsWith("//")) {
    return "Start with a single /: two slashes point the link at another site.";
  }

  if (!/^[/?#]/.test(href)) {
    return "Start with /, ? or #, for example ?modal=contact or /about?modal=contact. Use an External Link for other sites.";
  }

  return null;
}
