// The blog index's stored Markdown is published text, so its article list is read from the published
// perspective, never from the raw or drafts read that serialized the page around it.

import type { AgentMarkdownPage } from "~/features/agents/markdown";

export type AgentMarkdownSource = AgentMarkdownPage & { _id: string };

/** The published id behind a draft (`drafts.<id>`) or a release version (`versions.<release>.<id>`). */
export function publishedDocumentId(id: string): string {
  return id.replace(/^drafts\./, "").replace(/^versions\.[^.]+\./, "");
}

/** Swaps each listing's `articles` for its published document's; a listing never published lists nothing. */
export async function withPublishedArticleLists<T extends AgentMarkdownSource>(
  pages: T[],
  fetchPublished: (ids: string[]) => Promise<AgentMarkdownSource[]>
): Promise<T[]> {
  const listingIds = [
    ...new Set(pages.filter((page) => Array.isArray(page.articles)).map((page) => publishedDocumentId(page._id))),
  ];

  if (listingIds.length === 0) {
    return pages;
  }

  const published = await fetchPublished(listingIds);
  const articlesById = new Map(published.map((page) => [page._id, page.articles ?? []]));

  return pages.map((page) => {
    if (!Array.isArray(page.articles)) {
      return page;
    }

    return { ...page, articles: articlesById.get(publishedDocumentId(page._id)) ?? [] };
  });
}
