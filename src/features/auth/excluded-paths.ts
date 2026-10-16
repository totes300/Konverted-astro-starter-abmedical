// The routes `src/middleware.ts` never gates, read off the matched route rather than the request's spelling.
// Takes the Studio base path as an argument, so it reads no env and the test can run it outside Astro.

import { FEED_PATH } from "~/features/feed/constants";

function isStudioPath(pathname: string, studioBasePath: string): boolean {
  const base = studioBasePath.replace(/\/$/, "") || "/";

  return pathname === base || pathname.startsWith(`${base}/`);
}

/** A file a route is defined to serve (`/robots.txt`); a page route's pattern never carries an extension. */
function isFileRoute(pathname: string): boolean {
  // The feed carries whole article bodies, so unlike the other file routes it sits behind site-wide Basic Auth.
  if (pathname === FEED_PATH) {
    return false;
  }

  return /\.[a-z0-9]+$/i.test(pathname);
}

/** Pass `context.routePattern`, never the request path: `/x.html` is a page route's request, not a file route. */
export function isExcludedPath(routePattern: string, studioBasePath: string): boolean {
  if (isStudioPath(routePattern, studioBasePath)) {
    return true;
  }

  if (routePattern.startsWith("/api/")) {
    return true;
  }

  return isFileRoute(routePattern);
}
