// The section specimen's path test for the middleware gate and the sitemap (the base path is in `~/sanity/constants`).
// Its own module so both can read it without the preview registry, which reaches for Vite's `import.meta.glob`.

import { SECTION_PREVIEW_BASE_PATH } from "~/sanity/constants";

/** Sent on every response under the route, its 401 and 404 included, so nothing indexes or follows it. */
export const SECTION_PREVIEW_ROBOTS = "noindex, nofollow";

/** The route and everything under it, with or without a leading slash, never a path that only starts alike. */
export function isSectionPreviewPath(path: string) {
  const pathname = `/${path.replace(/^\/+/, "")}`;

  return pathname === SECTION_PREVIEW_BASE_PATH || pathname.startsWith(`${SECTION_PREVIEW_BASE_PATH}/`);
}
