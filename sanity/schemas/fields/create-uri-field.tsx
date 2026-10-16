import * as changeCase from "change-case";
import { defineField, type SlugOptions, type SlugRule, type SlugValue, type ValidationBuilder } from "sanity";
import { sanityConfig } from "../../config";
import {
  NOT_FOUND_PATH,
  SANITY_ARTICLE_DOCUMENT_TYPE,
  SANITY_AUTHOR_PATH_PREFIX,
  SANITY_BLOG_INDEX_URI,
  SANITY_PERSON_DOCUMENT_TYPE,
  SECTION_PREVIEW_BASE_PATH,
  SINGLETON_IDS,
} from "../../constants";
import { composeValidation } from "../../utils";
import { uriGateProblem } from "./uri-gate";

function normalizeSitePath(path: string) {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/") {
    return "/";
  }

  return trimmed.replace(/\/+$/, "") || "/";
}

/** Slug `current` may be `path` or `/path`; align with a leading slash when comparing. */
function comparableUriPath(value: string): string {
  const t = value.trim();
  if (t === "" || t === "/") {
    return "/";
  }

  return normalizeSitePath(t.startsWith("/") ? t : `/${t}`);
}

function sanitizeDocId(docId: string) {
  return docId.replace("drafts.", "");
}

function isAtOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

const ONE_SEGMENT = /^\/[^/]+$/;
// A person's page, and the `/modal` path a profile dialog may use.
const AUTHOR_ROUTE = /^\/[^/]+(?:\/modal)?$/;

/** `/blog/<slug>` and `/blog/authors/<slug>` are answered first by routes that serve only their own type. */
function blogRouteIssue(type: string | undefined, path: string): string | null {
  const isArticlePath =
    path.startsWith(`${SANITY_BLOG_INDEX_URI}/`) && ONE_SEGMENT.test(path.slice(SANITY_BLOG_INDEX_URI.length));
  const authorPath = path.startsWith(`${SANITY_AUTHOR_PATH_PREFIX}/`) ? path.slice(SANITY_AUTHOR_PATH_PREFIX.length) : "";

  if (type === SANITY_PERSON_DOCUMENT_TYPE) {
    return ONE_SEGMENT.test(authorPath)
      ? null
      : `A person's page is served at ${SANITY_AUTHOR_PATH_PREFIX}/<slug>. Use one segment under it.`;
  }

  if (type === SANITY_ARTICLE_DOCUMENT_TYPE) {
    return isArticlePath && path !== SANITY_AUTHOR_PATH_PREFIX
      ? null
      : `An article is served at ${SANITY_BLOG_INDEX_URI}/<slug>. Use one segment under it.`;
  }

  if (isArticlePath || AUTHOR_ROUTE.test(authorPath)) {
    return `${SANITY_BLOG_INDEX_URI}/<slug> is kept for articles, and ${SANITY_AUTHOR_PATH_PREFIX}/<slug> with its /modal path for people. Choose a different path.`;
  }

  return null;
}

/** Why this path is kept from documents: the Studio, the not-found page or the section preview holds it. */
function reservedRouteIssue(path: string): string | null {
  // Every path the host serves the Studio on, so a page is never authored where it would not be reached.
  const studioPath = sanityConfig.reservedStudioPaths.map(comparableUriPath).find((base) => isAtOrUnder(path, base));

  if (studioPath) {
    return `This URI is reserved for Sanity Studio (${studioPath}). Choose a different path.`;
  }

  if (path === NOT_FOUND_PATH) {
    return "This URI is reserved for the not-found page. Choose a different path.";
  }

  if (isAtOrUnder(path, SECTION_PREVIEW_BASE_PATH)) {
    return `This URI is reserved for the section preview (${SECTION_PREVIEW_BASE_PATH}). Choose a different path.`;
  }

  return null;
}

const reservedPathValidation: ValidationBuilder<SlugRule> = (R) =>
  R.custom((value: SlugValue | undefined, context) => {
    const current = value?.current?.trim();
    if (!current) {
      return true;
    }

    const uriP = comparableUriPath(current);
    const reservedIssue = reservedRouteIssue(uriP) ?? blogRouteIssue(context.document?._type, uriP);

    if (reservedIssue) {
      return reservedIssue;
    }

    // The blog index is its own singleton on its own route; a second document here would never be served.
    const docId = typeof context.document?._id === "string" ? sanitizeDocId(context.document._id) : null;

    if (uriP === comparableUriPath(SANITY_BLOG_INDEX_URI) && docId !== SINGLETON_IDS.blog) {
      return `This URI is reserved for the Blog index (${SANITY_BLOG_INDEX_URI}). Choose a different path.`;
    }

    return true;
  });

function uriGateCheck(value: SlugValue | undefined) {
  const current = value?.current?.trim();

  return current ? uriGateProblem(current) : null;
}

function isPasswordProtected(document: unknown): boolean {
  return (document as { passwordProtected?: boolean } | undefined)?.passwordProtected === true;
}

// A warning, so existing pages keep publishing; an error once Password protect would silently do nothing.
const gateSafeUriValidation = (R: SlugRule) => [
  R.custom((value: SlugValue | undefined, context) =>
    isPasswordProtected(context.document) ? (uriGateCheck(value) ?? true) : true
  ),
  R.custom((value: SlugValue | undefined, context) =>
    isPasswordProtected(context.document) ? true : (uriGateCheck(value) ?? true)
  ).warning(),
];

export function createUriField({
  group,
  options,
  source,
  slugify,
  name = "uri",
  title = "URI",
  description = "The URI of the document.",
  hidden,
  readOnly,
  initialPath,
  validation: externalValidation,
}: {
  group?: string;
  options?: Omit<SlugOptions, "slugify" | "source">;
  source: string;
  slugify?: (args: { originalInput: string; slug: string; parentId: string }) => string;
  name?: string;
  title?: string;
  description?: string;
  hidden?: (props: { parent: { [key: string]: unknown } }) => boolean;
  readOnly?: boolean | ((props: { parent: { [key: string]: unknown } }) => boolean);
  /** Prefills the slug, for documents whose path is fixed (a singleton route) rather than derived from `source`. Pair with `readOnly`. */
  initialPath?: string;
  validation?: ValidationBuilder<SlugRule, SlugValue>;
}) {
  return defineField({
    type: "slug",
    name,
    title,
    group,
    description,
    hidden,
    readOnly,
    initialValue: initialPath ? { current: initialPath } : undefined,
    validation: (rule) => [
      ...[composeValidation(reservedPathValidation, externalValidation)(rule)].flat(),
      ...gateSafeUriValidation(rule),
    ],
    options: {
      ...options,
      source,
      slugify: (input, _, { parent }) => {
        // @ts-expect-error The ID should exist.
        const parentId = parent?._id ? sanitizeDocId(parent._id) : null;
        const slug = changeCase.kebabCase(input);

        if (!parentId) {
          return "";
        }

        if (slugify) {
          return slugify({ slug, parentId, originalInput: input });
        }

        if (parentId === SINGLETON_IDS.homepage) {
          return "/";
        }

        return `/${changeCase.kebabCase(input)}`;
      },
    },
  });
}
