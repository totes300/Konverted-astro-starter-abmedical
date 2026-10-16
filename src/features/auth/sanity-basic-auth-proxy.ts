// The Basic Auth toggles for `src/middleware.ts`, the route cache and the sitemap. Live API, not the CDN:
// CDN publish invalidation misses result-set membership changes, which a security gate cannot ride on.

import { BASIC_AUTH_STATE_QUERY, type BasicAuthState, isProtectedPath, toBasicAuthState } from "~/features/auth/basic-auth-state";
import { createProxySanityState } from "~/features/sanity/proxy-state";
import { contentVersion } from "~/lib/content-version";
import { PUBLIC_SANITY_API_VERSION, PUBLIC_SANITY_DATASET, PUBLIC_SANITY_PROJECT_ID, SANITY_API_VIEW_TOKEN } from "~/lib/env";

export type { BasicAuthState };

/** Rejects only when no state has ever loaded, or the last one is past stale-if-error. */
export const getSanityBasicAuthState = createProxySanityState(
  BASIC_AUTH_STATE_QUERY,
  toBasicAuthState,
  {
    projectId: PUBLIC_SANITY_PROJECT_ID,
    dataset: PUBLIC_SANITY_DATASET,
    apiVersion: PUBLIC_SANITY_API_VERSION,
    token: SANITY_API_VIEW_TOKEN,
  },
  { version: () => contentVersion.read() }
);

/** False when the state is unknown, so nothing is served or stored as public on a guess. */
export async function isPublicPath(path: string): Promise<boolean> {
  try {
    return !isProtectedPath(await getSanityBasicAuthState(), path);
  } catch {
    return false;
  }
}

/** Site-wide protection, failing closed: an unknown state counts as locked. */
export async function isSiteLocked(): Promise<boolean> {
  try {
    return (await getSanityBasicAuthState()).siteWideEnabled;
  } catch {
    return true;
  }
}
