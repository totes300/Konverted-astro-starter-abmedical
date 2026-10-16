// The redirect paths the build keeps, checked in the Studio so an editor never saves one the build drops.
// The rules and their reasons: docs/features/redirects.md

export const MAX_REDIRECT_PATH_LENGTH = 1024;

const LITERAL_SEGMENT = /^[A-Za-z0-9._~%-]+$/;
const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)[*+?]?$/;
const PATTERN_SYNTAX = /[:*()[\]{}]/;
const QUERY = /^[A-Za-z0-9._~%=&+/-]*$/;
const FRAGMENT = /^[A-Za-z0-9._~%-]*$/;
// `%2F`, `%5C` and encoded control characters would let a segment hide a slash or a reserved prefix.
const UNSAFE_DECODED = /[/\\\p{Cc}]/u;

export type RedirectPathRules = {
  /** Whether the host's redirects take `:param` segments; one that matches exact, decoded paths drops them and never fires on a `%` escape. */
  patterns: boolean;
  /** Paths a From may not capture, in any letter case or encoding; anything under `/_` is always refused. */
  reservedPaths: string[];
};

type ParsedPath = { literals: string[]; params: string[] };

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function basicProblem(value: string): string | null {
  if (!value.startsWith("/")) {
    return 'Path must start with a "/" (e.g., "/about").';
  }

  // Browsers read `//host` and `/\host` as another site.
  if (value.startsWith("//") || /[\\\s\p{Cc}]/u.test(value)) {
    return 'Use a single leading "/" and no backslashes or spaces (e.g., "/about").';
  }

  if (value.length > MAX_REDIRECT_PATH_LENGTH) {
    return `Keep the path to ${MAX_REDIRECT_PATH_LENGTH} characters or fewer.`;
  }

  return null;
}

function segmentProblem(segment: string, patterns: boolean, escapes: boolean): string {
  if (segment.includes("?") || segment.includes("#")) {
    return 'Remove the "?" query and the "#" anchor: a From path matches the address alone.';
  }

  if (!patterns && PATTERN_SYNTAX.test(segment)) {
    return "This site's redirects match exact paths: use a plain path, without parameters or wildcards.";
  }

  if (segment === "") {
    return 'Remove the empty segment ("//").';
  }

  if (patterns) {
    return 'Use letters, digits, "-", "_", ".", "~" and "%" escapes in each segment, or a whole-segment parameter (":slug").';
  }

  if (escapes) {
    return 'Use letters, digits, "-", "_", ".", "~" and "%" escapes in each segment.';
  }

  return 'Use letters, digits, "-", "_", "." and "~" in each segment.';
}

/** `/a/:slug/b` as its literal segments up to the first parameter plus every parameter name, or the reason it is refused. */
function parsePath(path: string, patterns: boolean, escapes: boolean): ParsedPath | string {
  if (path === "/") {
    return { literals: [], params: [] };
  }

  const literals: string[] = [];
  const params: string[] = [];

  for (const segment of path.slice(1).replace(/\/$/, "").split("/")) {
    const param = patterns ? PARAM_SEGMENT.exec(segment)?.[1] : undefined;

    if (param) {
      if (params.includes(param)) {
        return `Use the parameter ":${param}" once.`;
      }

      params.push(param);
      continue;
    }

    if (!LITERAL_SEGMENT.test(segment)) {
      return segmentProblem(segment, patterns, escapes);
    }

    if (!escapes && segment.includes("%")) {
      return 'Remove the "%" escape: this site matches the decoded address, so an encoded From never fires.';
    }

    const decoded = safeDecode(segment);

    if (decoded === null) {
      return 'Fix the "%" escape: each must encode a valid character (e.g., "%C3%BC").';
    }

    if (decoded === "." || decoded === "..") {
      return 'Remove the "." and ".." segments.';
    }

    if (UNSAFE_DECODED.test(decoded)) {
      return 'Do not percent-encode a slash, a backslash or a control character ("%2F", "%5C").';
    }

    if (params.length === 0) {
      literals.push(decoded.toLowerCase());
    }
  }

  return { literals, params };
}

function startsWithSegments(path: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment);
}

function parseFrom(value: string, rules: RedirectPathRules): ParsedPath | string {
  const basic = basicProblem(value);

  if (basic) {
    return basic;
  }

  const parsed = parsePath(value, rules.patterns, rules.patterns);

  if (typeof parsed === "string") {
    return parsed;
  }

  if (parsed.literals[0]?.startsWith("_")) {
    return 'Choose a path that does not start with "/_": the framework and the host serve that namespace.';
  }

  for (const reserved of rules.reservedPaths) {
    const reservedSegments = reserved.toLowerCase().split("/").filter(Boolean);

    if (startsWithSegments(parsed.literals, reservedSegments)) {
      return `This path is reserved (${reserved}), so a redirect from it would never apply.`;
    }

    // A pattern whose parameters begin before the reserved path ends could still match it.
    if (parsed.params.length > 0 && startsWithSegments(reservedSegments, parsed.literals)) {
      return `This pattern could capture a reserved path (${reserved}). Start it with a fixed segment, such as "/blog/:slug".`;
    }
  }

  return parsed;
}

/** Why a From path would be dropped at build, or null when the build keeps it. */
export function redirectFromProblem(value: string, rules: RedirectPathRules): string | null {
  const parsed = parseFrom(value, rules);

  return typeof parsed === "string" ? parsed : null;
}

/** Why a To path would be dropped at build, or null when the build keeps it. Pass `from` to check its parameters. */
export function redirectToProblem(value: string, from: string | undefined, rules: RedirectPathRules): string | null {
  const basic = basicProblem(value);

  if (basic) {
    return basic;
  }

  let pathAndQuery = value;
  const hash = value.indexOf("#");

  if (hash !== -1) {
    if (!FRAGMENT.test(value.slice(hash + 1))) {
      return 'Use letters, digits, "-", "_", ".", "~" and "%" escapes in the "#" anchor (e.g., "/#contact").';
    }

    pathAndQuery = value.slice(0, hash);
  }

  const [path = "", query, ...rest] = pathAndQuery.split("?");

  if (rest.length > 0) {
    return 'Use a single "?" before the query.';
  }

  if (query !== undefined && (!QUERY.test(query) || query.includes("//"))) {
    return 'Use letters, digits and "=", "&", "+", "-", "_", ".", "~", "%", "/" in the query, with no "//" (e.g., "?ref=old").';
  }

  const parsed = parsePath(path, rules.patterns, true);

  if (typeof parsed === "string") {
    return parsed;
  }

  const source = from ? parseFrom(from, rules) : null;

  // An unparseable From carries its own error; only a valid one can be missing a parameter.
  if (source === null || typeof source === "string") {
    return null;
  }

  const missing = parsed.params.find((name) => !source.params.includes(name));

  return missing ? `From has no ":${missing}" parameter to fill this one with.` : null;
}

function withoutTrailingSlashes(path: string, end = path.length): string {
  let cut = end;

  // A loop rather than `/\/+$/`, which backtracks quadratically on a long run of slashes.
  while (cut > 1 && path[cut - 1] === "/") {
    cut -= 1;
  }

  return path.slice(0, cut);
}

function requestedAddress(path: string): string {
  const cut = path.search(/[?#]/);

  return withoutTrailingSlashes(path, cut === -1 ? path.length : cut);
}

// A trailing `:x*` or `:x?` can match nothing, so a From like `/blog/:rest*` also answers `/blog`.
const OPTIONAL_TAIL = /^(.*)\/:[a-z_][a-z0-9_]*[*?]$/;

/** Whether To sends the visitor back to From: an anchor, a query, a trailing slash or letter case does not change the match. */
export function redirectLoops(from: string, to: string): boolean {
  const target = requestedAddress(to).toLowerCase();
  // From carries no query or anchor, and its `?` can be an optional parameter (`:page?`).
  let source = withoutTrailingSlashes(from).toLowerCase();

  for (;;) {
    if (source === target) {
      return true;
    }

    const optional = OPTIONAL_TAIL.exec(source);

    if (!optional) {
      return false;
    }

    source = optional[1] || "/";
  }
}
