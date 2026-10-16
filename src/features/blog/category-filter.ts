// The category filter lives entirely in the URL, which is what keeps the filtering server-side:
// the list renders already filtered, needs no JavaScript, survives a reload, and is linkable.

/** The query parameter the filter reads and writes. Repeated once per selected category. */
export const CATEGORY_PARAM = "category";

const MAX_REQUESTED_CATEGORIES = 10;
const MAX_CATEGORY_SLUG_LENGTH = 64;
// Wider than the Studio's slug rule, so a slug saved before that rule still filters.
const CATEGORY_SLUG = /^[A-Za-z0-9_-]+$/;

/** The URL's slugs in a bounded, canonical form (valid, deduped, sorted, capped), since they reach the query and the cache key. */
export function requestedCategorySlugs(params: URLSearchParams): string[] {
  const valid = params
    .getAll(CATEGORY_PARAM)
    .map((value) => value.trim())
    .filter((slug) => slug.length <= MAX_CATEGORY_SLUG_LENGTH && CATEGORY_SLUG.test(slug));

  return [...new Set(valid)].sort().slice(0, MAX_REQUESTED_CATEGORIES);
}

/** The requested slugs `known` has, so the active chips always match what the query filtered on. */
export function selectedCategories(params: URLSearchParams, known: readonly string[]): string[] {
  const allowed = new Set(known);

  return requestedCategorySlugs(params).filter((slug) => allowed.has(slug));
}

/** Built from the category params alone: carrying an unknown query through a filter click would smuggle state into a cached URL. */
export function toggleCategoryHref(pathname: string, selected: readonly string[], slug: string): string {
  const next = selected.includes(slug) ? selected.filter((entry) => entry !== slug) : [...selected, slug];

  if (next.length === 0) {
    return pathname;
  }

  const params = new URLSearchParams();

  for (const entry of next) {
    params.append(CATEGORY_PARAM, entry);
  }

  return `${pathname}?${params.toString()}`;
}
