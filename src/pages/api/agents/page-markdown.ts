import type { APIRoute } from "astro";
import { pageToMarkdown } from "~/features/agents/markdown";
import { type AgentMarkdownSource, withPublishedArticleLists } from "~/features/agents/published-article-lists";
import { AgentMarkdownBackfillQuery, AgentMarkdownBacklogQuery, AgentMarkdownContentQuery } from "~/features/agents/query";
import { authorizeStudioRequest } from "~/features/api/auth";
import { apiErrorResponse, internalErrorResponse, privateJson } from "~/features/api/errors";
import { PUBLIC_SITE_URL } from "~/lib/env";
import type {
  AgentMarkdownBackfillQueryResult,
  AgentMarkdownBacklogQueryResult,
  AgentMarkdownContentQueryResult,
} from "~/sanity/types";
import { sanityEditClient } from "../../../sanity/lib/client";

// Studio-triggered per-page agent Markdown generation, and the backfill of every page still missing it.
export const prerender = false;

/** Serializing is local and free, so a batch is bounded by time, not credits; the Studio panel loops on `remaining`. */
const BACKFILL_TIME_BUDGET_MS = 40_000;
const BACKFILL_CHUNK_SIZE = 10;
const MAX_URI_LENGTH = 2048;

// Drafts and published are separate rows here, and a draft must be filled from its own content.
const rawClient = sanityEditClient.withConfig({ perspective: "raw" });
const publishedClient = sanityEditClient.withConfig({ perspective: "published" });

async function fetchPublishedPages(ids: string[]): Promise<AgentMarkdownSource[]> {
  const pages = await publishedClient.fetch<AgentMarkdownBackfillQueryResult>(AgentMarkdownBackfillQuery, { ids });

  return pages as AgentMarkdownSource[];
}

/** A page counts once, under its published id, and is missing when any of its versions is. */
async function readBacklog() {
  const versions = await rawClient.fetch<AgentMarkdownBacklogQueryResult>(AgentMarkdownBacklogQuery);
  const pages = new Map<string, boolean>();

  for (const version of versions) {
    const id = version._id.replace(/^drafts\./, "");
    pages.set(id, pages.get(id) === true || version.missing === true);
  }

  return {
    total: pages.size,
    missing: [...pages.values()].filter(Boolean).length,
    missingVersionIds: versions.filter((version) => version.missing === true).map((version) => version._id),
  };
}

async function backfill(versionIds: string[], signal: AbortSignal) {
  const deadline = Date.now() + BACKFILL_TIME_BUDGET_MS;
  const skipped: string[] = [];
  let filled = 0;
  let attempted = 0;

  while (attempted < versionIds.length && Date.now() < deadline && !signal.aborted) {
    const ids = versionIds.slice(attempted, attempted + BACKFILL_CHUNK_SIZE);
    const versions = await rawClient.fetch<AgentMarkdownBackfillQueryResult>(AgentMarkdownBackfillQuery, { ids });
    const pages = await withPublishedArticleLists(versions as AgentMarkdownSource[], fetchPublishedPages);
    const transaction = rawClient.transaction();
    let patched = 0;

    for (const page of pages) {
      const text = pageToMarkdown(page, PUBLIC_SITE_URL).trim();

      if (!text) {
        skipped.push(page._id);
        continue;
      }

      transaction.patch(page._id, (patch) => patch.setIfMissing({ agentMarkdown: {} }).set({ "agentMarkdown.content": text }));
      patched += 1;
    }

    if (patched > 0) {
      await transaction.commit();
    }

    filled += patched;
    attempted += ids.length;
  }

  return { filled, skipped, attempted };
}

/** Counts for the Studio backfill panel. */
export const GET: APIRoute = async ({ request }) => {
  const denied = await authorizeStudioRequest(request);

  if (denied) {
    return denied;
  }

  try {
    const { total, missing } = await readBacklog();

    return privateJson({ total, missing });
  } catch (error) {
    return internalErrorResponse(error, { error: "Failed to read agent Markdown stats.", code: "internal_error" });
  }
};

/** Two callers: the per-page Generate posts `{ uri }` and gets the text back; `{ backfill: true }` writes every missing version. */
export const POST: APIRoute = async ({ request }) => {
  const denied = await authorizeStudioRequest(request);

  if (denied) {
    return denied;
  }

  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);

    if (body?.backfill === true) {
      const { missingVersionIds } = await readBacklog();
      const { filled, skipped, attempted } = await backfill(missingVersionIds, request.signal);

      return privateJson({
        filled,
        skipped: skipped.length,
        remaining: missingVersionIds.length - attempted,
      });
    }

    const uri = typeof body?.uri === "string" ? body.uri.trim() : "";

    if (!uri || uri.length > MAX_URI_LENGTH) {
      return apiErrorResponse(400, { error: "Missing page URL. Save this page's URL, then try again.", code: "missing_uri" });
    }

    // No eligibility gate: a protected or noindex page may hold Markdown, since serving never returns it.
    const page = await sanityEditClient
      .withConfig({ perspective: "drafts" })
      .fetch<AgentMarkdownContentQueryResult>(AgentMarkdownContentQuery, { uri });

    if (!page) {
      return apiErrorResponse(404, { error: "No page found at this URL.", code: "page_not_found" });
    }

    const [source] = await withPublishedArticleLists([page as AgentMarkdownSource], fetchPublishedPages);
    const text = source ? pageToMarkdown(source, PUBLIC_SITE_URL).trim() : "";

    if (!text) {
      return apiErrorResponse(422, { error: "This page has no content to serialize yet.", code: "empty_page" });
    }

    return privateJson({ text });
  } catch (error) {
    return internalErrorResponse(error, { error: "Generation failed.", code: "internal_error" });
  }
};
