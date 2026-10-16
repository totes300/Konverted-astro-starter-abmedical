// The only module allowed to import `sanity:client` (Biome noRestrictedImports enforces it):
// every other consumer gets its client from here, so config seams stay in one place.

// biome-ignore lint/style/noRestrictedImports: this module IS the seam.
import { sanityClient as baseClient } from "sanity:client";
import { SANITY_API_EDIT_TOKEN, SANITY_API_VIEW_TOKEN } from "~/lib/env";

/** A stalled read fails the render in seconds, rather than holding the function to its 60 s maxDuration. */
const READ_TIMEOUT_MS = 10_000;

/** `loadQuery` keys every published read to the content version, so the render after a publish is a CDN miss by construction. */
export const sanityClient = baseClient.withConfig({ useCdn: true, timeout: READ_TIMEOUT_MS });

/** Published reads off the CDN with the view token, for an endpoint that needs a publish at once and no write access. */
export const sanityPublishedClient = baseClient.withConfig({
  token: SANITY_API_VIEW_TOKEN,
  useCdn: false,
  perspective: "published",
  stega: false,
  timeout: READ_TIMEOUT_MS,
});

/** Write-capable, for API routes only. Never import in a rendering path; generation routes override the perspective per call. */
export const sanityEditClient = baseClient.withConfig({
  token: SANITY_API_EDIT_TOKEN,
  useCdn: false,
  perspective: "published",
  stega: false,
});
