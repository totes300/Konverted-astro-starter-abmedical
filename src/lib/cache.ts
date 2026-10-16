// Cache tag model, shared by the pages that set tags and the webhook that invalidates them.
// Every page also carries the two site-wide singleton tags, since their content renders in every head.

import type { CacheOptions } from "astro";
import { SANITY_SINGLETON_SITE_ID, SANITY_SINGLETON_SITE_SETTINGS_ID } from "~/sanity/constants";

/** Publish-driven only; the year-long maxAge exists because the cache API requires one. */
export const CACHE_TTL = {
  maxAge: 31536000,
} as const;

type CacheTarget = {
  cache: { set(input: CacheOptions | false): void };
  locals: App.Locals;
};

/** How every route caches its response, or declines to with `false`: never under a draft session, whatever it asks. */
export function cacheResponse({ cache, locals }: CacheTarget, options: CacheOptions | false): void {
  cache.set(locals.draftSession ? false : options);
}

/** Every response they can change carries both: `site` owns the header, footer and SEO defaults, `siteSettings` the favicon. */
export const SITE_WIDE_CACHE_TAGS = [SANITY_SINGLETON_SITE_ID, SANITY_SINGLETON_SITE_SETTINGS_ID];

/** Stable per-document tag; draft ids collapse onto their published id. */
export function docTag(id: string): string {
  return `doc:${id.replace(/^drafts\./, "")}`;
}

/** The tags a routed document's response carries, and the ones a publish invalidates. */
export function docCacheTags({ _id, _type, uri }: { _id: string; _type: string; uri?: string | null }): string[] {
  const tags = [_type, docTag(_id)];

  if (uri) {
    tags.push(uri);
  }

  return tags;
}
