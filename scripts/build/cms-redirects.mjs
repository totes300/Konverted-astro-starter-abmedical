// Filters CMS redirects before Astro sees them: an entry Astro or the host rejects fails the whole build.
// Astro matches exact paths, so only plain same-site paths pass; the rules are in docs/features/redirects.md.

const LITERAL_SEGMENT = /^[A-Za-z0-9._~%-]+$/;
const QUERY = /^[A-Za-z0-9._~%=&+/-]*$/;
const FRAGMENT = /^[A-Za-z0-9._~%-]*$/;
// `%2F`, `%5C` and encoded control characters would let a segment hide a slash or a reserved prefix.
const UNSAFE_DECODED = /[/\\\p{Cc}]/u;

export const MAX_REDIRECT_PATH_LENGTH = 1024;

/**
 * @typedef {{ from?: unknown; to?: unknown; statusCode?: unknown }} CmsRedirect
 * @typedef {{ status: 301 | 302; destination: string }} ConfigRedirect
 * @typedef {{ siteHosts: string[]; reservedPaths: string[] }} RedirectRules
 */

/** @param {string} segment */
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Lowercased, decoded segments of a plain path (`/a/b` -> `["a", "b"]`), or null outside the subset.
 * @param {string} path
 * @returns {string[] | null}
 */
function parsePath(path) {
  if (path === "/") {
    return [];
  }

  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }

  const trimmed = path.endsWith("/") ? path.slice(1, -1) : path.slice(1);
  const segments = [];

  for (const segment of trimmed.split("/")) {
    const decoded = LITERAL_SEGMENT.test(segment) ? safeDecode(segment) : null;

    if (decoded === null || decoded === "." || decoded === ".." || UNSAFE_DECODED.test(decoded)) {
      return null;
    }

    segments.push(decoded.toLowerCase());
  }

  return segments;
}

/**
 * The same-site path a destination lands on, without its query or anchor, or null outside the subset.
 * @param {string} destination
 * @param {string[]} siteHosts
 * @returns {string | null}
 */
function destinationPath(destination, siteHosts) {
  let pathAndQuery = destination;

  if (destination.startsWith("https://")) {
    let url;

    try {
      url = new URL(destination);
    } catch {
      return null;
    }

    if (url.username || url.password || !siteHosts.includes(url.host.toLowerCase())) {
      return null;
    }

    const rest = destination.slice(`https://${url.host}`.length);
    pathAndQuery = rest === "" || rest.startsWith("#") || rest.startsWith("?") ? `/${rest}` : rest;
  }

  // A fragment never leaves the browser, so a section anchor (`/#contact`) cannot point off the site.
  const hash = pathAndQuery.indexOf("#");

  if (hash !== -1) {
    if (!FRAGMENT.test(pathAndQuery.slice(hash + 1))) {
      return null;
    }

    pathAndQuery = pathAndQuery.slice(0, hash);
  }

  const [path = "", query, ...rest] = pathAndQuery.split("?");

  if (rest.length > 0 || (query !== undefined && (!QUERY.test(query) || query.includes("//")))) {
    return null;
  }

  return parsePath(path) ? path : null;
}

/** @param {string} path */
function withoutTrailingSlash(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * @param {string[]} path
 * @param {string[]} prefix
 */
function startsWithSegments(path, prefix) {
  return prefix.every((segment, index) => path[index] === segment);
}

/**
 * Why an entry is refused, or `null` when it is safe to hand to Astro.
 * @param {string} source
 * @param {string} destination
 * @param {RedirectRules} rules
 * @returns {string | null}
 */
export function redirectProblem(source, destination, rules) {
  if (source.length > MAX_REDIRECT_PATH_LENGTH || destination.length > MAX_REDIRECT_PATH_LENGTH) {
    return `source or destination is longer than ${MAX_REDIRECT_PATH_LENGTH} characters`;
  }

  // Astro matches the decoded request path, so a source with a `%` escape never fires.
  if (source.includes("%")) {
    return "source has a % escape, which never matches a request";
  }

  const sourceSegments = parsePath(source);

  if (!sourceSegments) {
    return "source is not a plain same-site path";
  }

  const target = destinationPath(destination, rules.siteHosts);

  if (target === null) {
    return "destination is neither a plain same-site path nor an https URL on this site";
  }

  // Framework and host internals (`/_astro`, `/_image`, `/_server-islands`) all live under an underscore prefix.
  if (sourceSegments[0]?.startsWith("_")) {
    return "source would capture a framework path";
  }

  const capturesReserved = rules.reservedPaths.some((reserved) =>
    startsWithSegments(sourceSegments, reserved.toLowerCase().split("/").filter(Boolean))
  );

  if (capturesReserved) {
    return "source would capture a reserved path";
  }

  // The anchor never reaches the server, and neither the query, a trailing slash nor letter case changes the match.
  if (withoutTrailingSlash(target).toLowerCase() === withoutTrailingSlash(source).toLowerCase()) {
    return "destination is the source's own address, so the redirect would loop";
  }

  return null;
}

/**
 * Astro's `redirects` map from the CMS entries, logging and dropping every entry outside the subset.
 * @param {unknown} entries
 * @param {RedirectRules} rules
 * @returns {Record<string, ConfigRedirect>}
 */
export function toConfigRedirects(entries, rules) {
  if (!Array.isArray(entries)) {
    return {};
  }

  /** @type {Record<string, ConfigRedirect>} */
  const redirects = {};

  for (const entry of /** @type {(CmsRedirect | null)[]} */ (entries)) {
    const { from, to, statusCode } = entry ?? {};

    if (typeof from !== "string" || typeof to !== "string") {
      console.error("[redirects] Skipping a redirect without string from/to:", JSON.stringify(entry));
      continue;
    }

    const problem = redirectProblem(from, to, rules);

    if (problem) {
      console.error(`[redirects] Skipping ${JSON.stringify(from)} -> ${JSON.stringify(to)}: ${problem}`);
      continue;
    }

    redirects[from] = { status: statusCode === 302 ? 302 : 301, destination: to };
  }

  return redirects;
}

/**
 * The apex and `www` hosts of the site URL, whichever of the two it names; empty when unset or invalid.
 * @param {string | undefined} siteUrl
 * @returns {string[]}
 */
export function siteHostsOf(siteUrl) {
  if (!siteUrl || !URL.canParse(siteUrl)) {
    return [];
  }

  const apex = new URL(siteUrl).host.toLowerCase().replace(/^www\./, "");

  return [apex, `www.${apex}`];
}
