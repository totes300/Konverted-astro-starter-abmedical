// What `src/middleware.ts` does with a request before any Basic Auth state is read, from the matched route
// and the canonical path alone. Pure, so every bypass spelling is tested outside Astro.

import { canonicalRequestPath, isPageAliasSpelling } from "~/features/auth/canonical-path";
import { isExcludedPath } from "~/features/auth/excluded-paths";
import { isSectionPreviewPath } from "~/features/page-builder/section-preview-path";
import { NOT_FOUND_PATH } from "~/sanity/constants";

/** The route Astro renders a 404 through, middleware included; on it the request path is not this route's own. */
export const NOT_FOUND_ROUTE = NOT_FOUND_PATH;

/** Unused here, and it would re-serve any same-origin body under a type the caller picks. */
const ASTRO_IMAGE_ROUTE = "/_image";

export type GateDecision =
  | { kind: "exempt" }
  | { kind: "bad-request" }
  | { kind: "section-preview" }
  | { kind: "not-found" }
  | { kind: "page"; path: string };

type GateInput = {
  routePattern: string;
  /** `requestPathname(context.request)`, never `context.url.pathname`. */
  pathname: string;
  studioBasePath: string;
};

/** The path as the URL parser resolves it, nothing decoded, which the route cache keys on; `context.url` has turned a decoded `\` into `/`. */
export function requestPathname(request: Request): string {
  return new URL(request.url).pathname;
}

export function classifyRequest({ routePattern, pathname, studioBasePath }: GateInput): GateDecision {
  if (routePattern === ASTRO_IMAGE_ROUTE) {
    return { kind: "not-found" };
  }

  if (isExcludedPath(routePattern, studioBasePath)) {
    return { kind: "exempt" };
  }

  const path = canonicalRequestPath(pathname);

  if (path === null) {
    return { kind: "bad-request" };
  }

  // Ahead of every bypass: neither the CMS toggles nor a preview cookie opens the specimen.
  if (isSectionPreviewPath(path) || isSectionPreviewPath(pathname)) {
    return { kind: "section-preview" };
  }

  // One URL per page, so a second spelling can never be the one a gate or the cache keys differently.
  if (routePattern !== NOT_FOUND_ROUTE && isPageAliasSpelling(pathname)) {
    return { kind: "not-found" };
  }

  return { kind: "page", path };
}
