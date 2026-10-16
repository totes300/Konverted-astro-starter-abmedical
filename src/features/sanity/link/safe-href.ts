// A CMS href reaches `href` attributes verbatim, so anything outside this allowlist (`javascript:`, `data:`) is dropped.

import { joinSiteUrl } from "~/lib/site-url";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: browsers strip these while parsing, which is how a scheme hides.
const UNPARSEABLE = /[\u0000-\u001f\u007f\\]/;

/** The trimmed href when it is site-relative (`/`, `?`, `#`) or uses an allowed scheme; null for anything else. */
export function safeHref(href: string | null | undefined): string | null {
  const trimmed = (href ?? "").trim();

  if (!trimmed || UNPARSEABLE.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return trimmed.startsWith("//") ? null : trimmed;
  }

  if (trimmed.startsWith("?") || trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

/** `safeHref` made absolute for a reader outside the site (a feed, agent Markdown); a fragment stays as it is. */
export function absoluteSafeHref(href: string | null | undefined, baseUrl: string): string | null {
  const safe = safeHref(href);

  if (!safe || safe.startsWith("#")) {
    return safe;
  }

  return new URL(safe, joinSiteUrl(baseUrl)).href;
}
