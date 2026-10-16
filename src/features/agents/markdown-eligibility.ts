// Which routes may be served as agent Markdown: an allowlist, so a route missing from the snapshot is never served.
// Pure, so the middleware rewrite and the Markdown route share it and it runs under `node --test`.

import { canonicalUri } from "~/features/auth/canonical-path";
import { SANITY_SINGLETON_SITE_SETTINGS_ID } from "~/sanity/constants";

/** A page that must not reach an agent: its own Markdown is never served and stored Markdown stops linking it. */
export const GATED_ROUTE_FILTER = "seoMetadata.noIndex == true || passwordProtected == true";

type AgentMarkdownRoute = { uri?: string | null; excluded?: boolean | null; gated?: boolean | null };

type AgentMarkdownRoutes = (AgentMarkdownRoute | null)[] | null | undefined;

export type AgentMarkdownPayload = { siteLocked?: boolean | null; routes?: AgentMarkdownRoutes } | null;

/** Request-facing shape: paths pre-normalized into Sets once per fetch (O(1) per request). */
export type AgentMarkdownState = {
  siteLocked: boolean;
  eligiblePathSet: ReadonlySet<string>;
  /** Protected or `noIndex` now, so Markdown stored before the change must stop linking them. */
  gatedPathSet: ReadonlySet<string>;
};

function pathSet(routes: AgentMarkdownRoutes, keep: (route: AgentMarkdownRoute) => boolean): Set<string> {
  const paths = (routes ?? [])
    .filter((route): route is AgentMarkdownRoute & { uri: string } => Boolean(route) && typeof route?.uri === "string")
    .filter(keep)
    .map((route) => canonicalUri(route.uri));

  return new Set(paths);
}

export function toAgentMarkdownState(payload: AgentMarkdownPayload): AgentMarkdownState {
  return {
    siteLocked: payload?.siteLocked === true,
    // `excluded === false`, not `!excluded`: a flag the query could not evaluate must not open a route.
    eligiblePathSet: pathSet(payload?.routes, (route) => route.excluded === false),
    gatedPathSet: pathSet(payload?.routes, (route) => route.gated === true),
  };
}

export function isAgentMarkdownEligible(state: AgentMarkdownState, path: string): boolean {
  return !state.siteLocked && state.eligiblePathSet.has(canonicalUri(path));
}

// Project over the STABLE set, never filter: membership changes on first generation and even the live API misses it.
export const AGENT_MARKDOWN_STATE_QUERY = `{
  "siteLocked": *[_id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].basicAuth.siteWideEnabled,
  "routes": *[defined(uri.current)]{
    "uri": uri.current,
    "excluded": ${GATED_ROUTE_FILTER}
      || agentMarkdown.enabled == false
      || !defined(agentMarkdown.content)
      || agentMarkdown.content == "",
    "gated": ${GATED_ROUTE_FILTER}
  }
}`;
