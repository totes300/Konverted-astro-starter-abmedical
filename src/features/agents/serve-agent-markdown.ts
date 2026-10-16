// The serve route's decision (its two reads injected) and the middleware's 404 choice, so both run and are tested outside Astro.

import { dropGatedLinks } from "~/features/agents/gated-links";
import { type AgentMarkdownState, isAgentMarkdownEligible } from "~/features/agents/markdown-eligibility";
import { renderNotFoundMarkdown } from "~/features/agents/not-found-markdown";
import { isMarkdownRequest } from "~/features/agents/prefers-markdown";
import { NOT_FOUND_ROUTE } from "~/features/auth/request-gate";

const MARKDOWN_HEADERS = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "public, max-age=0, must-revalidate",
  vary: "Accept",
};

/** The agent's 404: a Markdown recovery map, from the serve route and from the middleware's 404 pass alike. */
export function notFoundMarkdown(siteUrl: string): Response {
  return new Response(renderNotFoundMarkdown(siteUrl), { status: 404, headers: MARKDOWN_HEADERS });
}

type NotFoundPass = { routePattern: string; request: Request };

/** What the gate wraps on the 404 route: the Markdown map for an agent's GET, else the 404 page; null on any other route. */
export function notFoundRender(
  { routePattern, request }: NotFoundPass,
  siteUrl: string,
  next: () => Promise<Response>
): (() => Promise<Response>) | null {
  if (routePattern !== NOT_FOUND_ROUTE) {
    return null;
  }

  return isMarkdownRequest(request) ? async () => notFoundMarkdown(siteUrl) : next;
}

type StoredMarkdown = { enabled?: boolean | null; content?: string | null } | null | undefined;

type ServeAgentMarkdownInput = {
  /** Canonical page path, already normalized. */
  uri: string;
  siteUrl: string;
  readState: () => Promise<AgentMarkdownState>;
  readStoredMarkdown: (uri: string) => Promise<StoredMarkdown>;
};

/** 404 with a Markdown recovery map unless the allowlist names `uri`; the content read runs only after that check. */
export async function serveAgentMarkdown({
  uri,
  siteUrl,
  readState,
  readStoredMarkdown,
}: ServeAgentMarkdownInput): Promise<Response> {
  let state: AgentMarkdownState;

  try {
    state = await readState();
  } catch (error) {
    console.error("agent-markdown: eligibility state unavailable", error);

    return notFoundMarkdown(siteUrl);
  }

  // The middleware never runs on `/api/`, so a direct hit has to clear the same allowlist the rewrite does.
  if (!isAgentMarkdownEligible(state, uri)) {
    return notFoundMarkdown(siteUrl);
  }

  const stored = await readStoredMarkdown(uri);
  const content = stored?.enabled !== false && typeof stored?.content === "string" ? stored.content.trim() : "";

  if (!content) {
    return notFoundMarkdown(siteUrl);
  }

  return new Response(`${dropGatedLinks(content, state.gatedPathSet, siteUrl)}\n`, { status: 200, headers: MARKDOWN_HEADERS });
}
