import { defineQuery } from "groq";
import { GATED_ROUTE_FILTER } from "~/features/agents/markdown-eligibility";
import { LinkFn, link } from "~/features/sanity/link/fragment";
import {
  SANITY_ARTICLE_DOCUMENT_TYPE,
  SANITY_LEGAL_PAGE_DOCUMENT_TYPE,
  SANITY_PAGE_DOCUMENT_TYPE,
  SANITY_PERSON_DOCUMENT_TYPE,
  SANITY_SINGLETON_BLOG_ID,
  SANITY_SINGLETON_SITE_ID,
  SANITY_SINGLETON_SITE_SETTINGS_ID,
} from "~/sanity/constants";

/** Site-wide Basic Auth is on. The files that index the whole site (`/llms.txt`, `/openapi.json`) answer 404 then. */
export const SiteLockedQuery = defineQuery(
  `*[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].basicAuth.siteWideEnabled == true`
);

/**
 * Content served at `/llms.txt`. Read from the published `siteSettings` singleton.
 * `enabled` gates serving (undefined is treated as on); `content` is the markdown body.
 */
export const LlmsTxtServeQuery =
  defineQuery(`*[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0]{
  "enabled": llms.enabled,
  "content": llms.content,
  "gatedPaths": *[defined(uri.current) && (${GATED_ROUTE_FILTER})].uri.current
}`);

// The routed types, each carrying `createAgentMarkdownField`.
const RoutedDocumentTypes = `["${SANITY_PAGE_DOCUMENT_TYPE}", "${SANITY_LEGAL_PAGE_DOCUMENT_TYPE}", "${SANITY_ARTICLE_DOCUMENT_TYPE}", "${SANITY_PERSON_DOCUMENT_TYPE}", "${SANITY_SINGLETON_BLOG_ID}"]`;

/** Site identity plus the indexable pages, on the sitemap's visibility rules. Server-side with an edit token, `published` perspective. */
export const LlmsTxtInventoryQuery = defineQuery(`{
  "site": *[_type == "${SANITY_SINGLETON_SITE_ID}" && _id == "${SANITY_SINGLETON_SITE_ID}"][0]{
    name,
    "summary": seoMetadata.description,
    "guidance": *[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].llms.guidance
  },
  "pages": *[
    _type in ${RoutedDocumentTypes}
    && defined(uri.current)
    && seoMetadata.noIndex != true
    && passwordProtected != true
  ] | order(_type asc, coalesce(publishedAt, _createdAt) desc) {
    _type,
    "uri": uri.current,
    "title": coalesce(seoMetadata.title, title, name),
    "description": seoMetadata.description,
    "publishedAt": publishedAt,
    "categories": categories[]->name
  }
}`);

// Lean Portable Text projection for Markdown: block style, list shape, span marks, link hrefs, media-block images.
const AgentMarkdownRichTextFn = `fn frag::agentRichText($value) = $value[]{
  _type,
  _type == "block" => {
    style,
    listItem,
    level,
    "children": children[]{ _type, text, marks },
    "markDefs": markDefs[]{
      _key,
      _type,
      _type == "linkField" => ${link("@")}
    }
  },
  _type == "mediaBlock" => {
    caption,
    "alt": appMedia.image.asset->altText,
    "imageUrl": appMedia.image.asset->url
  }
};`;

/** Shared with the RSS feed, which serializes the same reader-facing block shapes to HTML. */
export const agentRichText = (path: string) => `frag::agentRichText(${path})`;

/** Interpolate once at the head of any query calling `agentRichText`. */
export const AgentMarkdownFunctions = `${LinkFn}\n${AgentMarkdownRichTextFn}`;

// The guaranteed page-builder factory outputs, aliased to the keys their default renderers in `markdown.ts` read.
const FactorySectionContentFragment = `
  "text": ${agentRichText("sectionContent.appRichText")},
  "media": sectionContent.appMedia{
    "alt": image.asset->altText,
    "imageUrl": image.asset->url
  },
  "cta": ${link("sectionContent.appLink")}
`;

// The per-project seam: add an alias here and a renderer in `markdown.ts`. Hand-written, since typegen needs a static string.
const AgentMarkdownSectionContentFragment = `
  ${FactorySectionContentFragment},
  "headline": sectionContent.headline,
  "caption": sectionContent.caption
`;

// No page builder: rendered by `renderArticleList`, after the generate route swaps in the published list.
const AgentMarkdownArticleListFragment = `
  "heading": heading,
  "intro": ${agentRichText("intro")},
  "articles": *[
    _type == "${SANITY_ARTICLE_DOCUMENT_TYPE}"
    && defined(uri.current)
    && seoMetadata.noIndex != true
    && passwordProtected != true
  ] | order(publishedAt desc){
    "uri": uri.current,
    title,
    "description": seoMetadata.description,
    publishedAt
  }`;

// Shared by the per-page Generate and the backfill, so both serialize the same shape.
const AgentMarkdownPageProjection = `{
  _id,
  _type,
  "uri": coalesce(uri.current, "/"),
  "title": coalesce(seoMetadata.title, title, name),
  "description": seoMetadata.description,
  publishedAt,
  "author": author->name,
  "categories": categories[]->name,
  "sections": pageBuilder.sectionsArray[sectionSettings.disabled != true]{
    _type,
    ${AgentMarkdownSectionContentFragment}
  },
  // Articles have no page builder: the body is one rich text field on the document.
  "content": ${agentRichText("content")},
  // A person's body is their bio, under a different field name.
  _type == "${SANITY_PERSON_DOCUMENT_TYPE}" => {
    "content": ${agentRichText("bio")},
  },
  _type == "${SANITY_SINGLETON_BLOG_ID}" => {${AgentMarkdownArticleListFragment}
  }
}`;

// Matched on `uri.current`, so new routed types are covered; serving is gated elsewhere, not here.
export const AgentMarkdownContentQuery = defineQuery(`${AgentMarkdownFunctions}
*[
  defined(uri.current)
  && uri.current == $uri
][0]${AgentMarkdownPageProjection}`);

/** Every published and draft version with serving on. Run under the `raw` perspective so drafts and published are listed apart. */
export const AgentMarkdownBacklogQuery = defineQuery(`*[
  _type in ${RoutedDocumentTypes}
  && defined(uri.current)
  && !(_id in path("versions.**"))
  && agentMarkdown.enabled != false
  && passwordProtected != true
] | order(_updatedAt desc) {
  _id,
  "missing": !defined(agentMarkdown.content) || agentMarkdown.content == ""
}`);

/** The backfill's batch: exact versions by `_id`, under the `raw` perspective, so a draft is serialized from its own content. */
export const AgentMarkdownBackfillQuery = defineQuery(`${AgentMarkdownFunctions}
*[_id in $ids]${AgentMarkdownPageProjection}`);

/** `enabled` gates serving (undefined is on); `content` is the Markdown body. Never matches a gated page or a locked site. */
export const AgentMarkdownServeQuery = defineQuery(`*[
  defined(uri.current)
  && uri.current == $uri
  && seoMetadata.noIndex != true
  && passwordProtected != true
  && *[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].basicAuth.siteWideEnabled != true
][0]{
  "enabled": agentMarkdown.enabled,
  "content": agentMarkdown.content
}`);

/** `enabled` gates only the upload path (undefined is off, since it spends credits); a backfill runs either way. */
export const AltTextSettingsQuery =
  defineQuery(`*[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0]{
  "enabled": altText.enabled,
  "guidance": altText.guidance
}`);

/** Alt text lives on the asset, so one description covers every document that references the image. */
export const AltTextAssetQuery = defineQuery(`*[_type == "sanity.imageAsset" && _id == $assetId][0]{
  _id,
  url,
  extension,
  altText,
  "filename": originalFilename
}`);

/** `$force` widens it to every asset. Not sliced in GROQ: the caller takes the batch its time budget allows. */
export const AltTextBacklogQuery = defineQuery(`*[
  _type == "sanity.imageAsset"
  && extension != "svg"
  && ($force == true || !defined(altText))
] | order(_createdAt desc) {
  _id,
  url,
  extension,
  "filename": originalFilename
}`);

/** Counts behind the backfill panel in the Studio. */
export const AltTextStatsQuery = defineQuery(`{
  "total": count(*[_type == "sanity.imageAsset" && extension != "svg"]),
  "missing": count(*[_type == "sanity.imageAsset" && extension != "svg" && !defined(altText)]),
  "enabled": *[_type == "${SANITY_SINGLETON_SITE_SETTINGS_ID}" && _id == "${SANITY_SINGLETON_SITE_SETTINGS_ID}"][0].altText.enabled
}`);
