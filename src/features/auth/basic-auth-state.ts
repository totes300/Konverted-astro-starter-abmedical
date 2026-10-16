// The published Basic Auth toggles in the shape the gates read, with no env so the rules run under `node --test`.

import { canonicalUri } from "~/features/auth/canonical-path";
import { SANITY_SINGLETON_SITE_SETTINGS_ID } from "~/sanity/constants";

export type BasicAuthPayload = {
  basicAuth?: {
    siteWideEnabled?: boolean | null;
  } | null;
  protectedPaths?: (string | null)[] | null;
} | null;

/** Paths canonicalized into a Set once per fetch, so the per-request check is O(1) and spelling-proof. */
export type BasicAuthState = {
  siteWideEnabled: boolean;
  protectedPathSet: ReadonlySet<string>;
};

// The singleton by `_id`, so a second document of the same type can never stand in for it.
export const BASIC_AUTH_STATE_QUERY = `{
  "basicAuth": *[_id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].basicAuth{
    siteWideEnabled
  },
  "protectedPaths": *[passwordProtected == true && defined(uri.current)].uri.current
}`;

export function toBasicAuthState(payload: BasicAuthPayload): BasicAuthState {
  const paths = (payload?.protectedPaths ?? []).filter((path): path is string => typeof path === "string");

  return {
    siteWideEnabled: payload?.basicAuth?.siteWideEnabled === true,
    protectedPathSet: new Set(paths.map(canonicalUri)),
  };
}

/** Whether Basic Auth covers a page path, under whichever spelling of it the caller holds. */
export function isProtectedPath(state: BasicAuthState, path: string): boolean {
  return state.siteWideEnabled || state.protectedPathSet.has(canonicalUri(path));
}
