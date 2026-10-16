// The one path the gates and the route cache key on: the page the router renders, spelled one way.
// The spellings each rule closes: docs/features/basic-auth.md#one-path-per-page

import { normalizePathname } from "~/features/utils/pathname";

/** The router's own decode budget; a path still changing after it is refused, as the router refuses it. */
const MAX_DECODE_ITERATIONS = 10;

const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/;

function decodeFully(pathname: string): string | null {
  let current = pathname;

  for (let iteration = 0; iteration <= MAX_DECODE_ITERATIONS; iteration++) {
    let decoded: string;

    try {
      decoded = decodeURI(current);
    } catch {
      return null;
    }

    if (decoded === current) {
      return current;
    }

    current = decoded;
  }

  return null;
}

/** The path the router matches, or null for a spelling (`%2F`, `%25`, `\`, `..`) it and a gate could read apart. */
export function decodeRequestPath(pathname: string): string | null {
  const decoded = decodeFully(pathname);

  if (decoded === null || decoded.includes("%") || decoded.includes("\\") || DOT_SEGMENT.test(decoded)) {
    return null;
  }

  return normalizePathname(decoded.replace(/\/{2,}/g, "/"));
}

/** A stored `uri.current` in the form request paths take: leading slash, NFC, no trailing slash. */
export function canonicalUri(uri: string): string {
  const path = uri.startsWith("/") ? uri : `/${uri}`;

  return normalizePathname(path.normalize("NFC"));
}

/** The page a request path gates as: `.html` and `/index.html` stripped the way the router strips them for pages. */
export function canonicalRequestPath(pathname: string): string | null {
  const path = decodeRequestPath(pathname);

  if (path === null) {
    return null;
  }

  return canonicalUri(path.replace(/\/index\.html$/, "/").replace(/\.html$/, ""));
}

/** A file-style second spelling of a page (`/about.html`, `/index`), which the site answers with a 404. */
export function isPageAliasSpelling(pathname: string): boolean {
  const path = decodeRequestPath(pathname);

  return path !== null && (/\.html?$/i.test(path) || path === "/index");
}
