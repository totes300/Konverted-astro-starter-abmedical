// The agent-Markdown eligibility snapshot for `src/middleware.ts` and the Markdown route. Rules live in
// `./markdown-eligibility`, cache mechanics in `~/features/sanity/proxy-state`.

import { AGENT_MARKDOWN_STATE_QUERY, toAgentMarkdownState } from "~/features/agents/markdown-eligibility";
import { createProxySanityState } from "~/features/sanity/proxy-state";
import { contentVersion } from "~/lib/content-version";
import { PUBLIC_SANITY_API_VERSION, PUBLIC_SANITY_DATASET, PUBLIC_SANITY_PROJECT_ID, SANITY_API_VIEW_TOKEN } from "~/lib/env";

// Under `/api`, so the `[...uri]` page route never matches it.
export const AGENT_MARKDOWN_INTERNAL_BASE_PATH = "/api/agent-markdown";

// Version-tied like the gate state, so a published site lock applies on the next request.
export const getAgentMarkdownState = createProxySanityState(
  AGENT_MARKDOWN_STATE_QUERY,
  toAgentMarkdownState,
  {
    projectId: PUBLIC_SANITY_PROJECT_ID,
    dataset: PUBLIC_SANITY_DATASET,
    apiVersion: PUBLIC_SANITY_API_VERSION,
    token: SANITY_API_VIEW_TOKEN,
  },
  { version: () => contentVersion.read() }
);
