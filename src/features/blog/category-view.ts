// The blog index's category view: the slugs its list knows, and whether a view may be cached.

import { stegaClean } from "@sanity/client/stega";
import { CATEGORY_PARAM, requestedCategorySlugs } from "./category-filter";

type ListedCategory = { slug?: string | null };

/** The slugs the filter chips carry, stega removed so they compare equal to the URL's. */
export function knownCategorySlugs(categories: readonly ListedCategory[] | null | undefined): string[] {
  return (categories ?? []).map((category) => stegaClean(category.slug) ?? "").filter(Boolean);
}

/** Known categories, canonically spelled, only: a made-up or repeated slug mints no entry. */
export function isCacheableCategoryView(params: URLSearchParams, knownSlugs: readonly string[]): boolean {
  const raw = params.getAll(CATEGORY_PARAM).sort();
  const requested = requestedCategorySlugs(params);
  const known = new Set(knownSlugs);

  return raw.length === requested.length && raw.every((slug, index) => slug === requested[index] && known.has(slug));
}
