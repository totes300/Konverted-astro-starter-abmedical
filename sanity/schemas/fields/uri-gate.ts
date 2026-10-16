// URI shapes another route shadows or the gate refuses.
// The rules and their reasons: docs/features/basic-auth.md#uris-the-gate-cannot-cover

const API_PREFIX = "/api";

// Framework and host internals (build assets, platform endpoints) all live under an underscore prefix.
const INTERNAL_PREFIX = "/_";

const HOMEPAGE_ALIAS = "/index";

const CONTROL_CHARACTER = /\p{Cc}/u;

/** Why a page at this URI would be shadowed or escape the access checks, or null when it is safe. */
export function uriGateProblem(uri: string): string | null {
  if (/\s/.test(uri)) {
    return "Remove the spaces: a URI with whitespace is not a stable address.";
  }

  if (CONTROL_CHARACTER.test(uri)) {
    return "Remove the invisible control character: browsers rewrite it, so the address would not reliably reach this page.";
  }

  if (uri.includes("\\")) {
    return "Remove the backslash: browsers read it as a slash, so the page's address and its Password protect check would name different pages.";
  }

  if (uri.includes("%")) {
    return "Remove the % sign: the site decodes addresses before matching them, so this page would never be found.";
  }

  if (uri.includes(":")) {
    return "Remove the colon: an address with a colon can be read as a link scheme (javascript:, mailto:) instead of a page.";
  }

  if (uri.includes(".")) {
    return "Remove the dot: an address that looks like a file name (.html, .pdf) is handled as a file, so a file or a 404 can answer instead of this page, or, on a host that serves file-like addresses before its checks, the page can skip Password protect.";
  }

  const path = uri.startsWith("/") ? uri : `/${uri}`;

  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) {
    return `Choose a path outside ${API_PREFIX}/: that namespace is reserved for the site's endpoints, so an endpoint can answer instead of this page.`;
  }

  if (path.startsWith(INTERNAL_PREFIX)) {
    return `Choose a path that does not start with ${INTERNAL_PREFIX}: the framework and the host reserve that namespace, so they can answer before or instead of this page.`;
  }

  if (path.replace(/\/+$/, "") === HOMEPAGE_ALIAS) {
    return `${HOMEPAGE_ALIAS} is a second spelling of the homepage, so a request for this page can be treated as the homepage instead. Choose a different path.`;
  }

  return null;
}
