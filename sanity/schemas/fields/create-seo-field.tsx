import { defineField } from "sanity";
import { SeoImageInput } from "../../inputs/seo-image-input";
import { isHomepageDocument } from "../../utils";

const NO_INDEX_DESCRIPTION =
  "Keep this page out of search engines, the sitemap, the RSS feed, llms.txt and agent Markdown. An article also leaves the blog index, its author's page and the category filter. The page itself stays reachable at its URL.";

type SeoFieldOptions = {
  group?: string;
  name?: string;
  /** For a document whose switch means something other than hiding one page (the Site singleton's applies to every page). */
  noIndexDescription?: string;
};

export function createSeoField({ group, name = "seoMetadata", noIndexDescription = NO_INDEX_DESCRIPTION }: SeoFieldOptions = {}) {
  return defineField({
    name,
    type: "object",
    title: "SEO Metadata",
    description: "Setup SEO meta data for this document.",
    group,
    options: {
      collapsed: false,
      collapsible: false,
    },
    fields: [
      defineField({
        name: "noIndex",
        type: "boolean",
        title: "No Index",
        description: noIndexDescription,
        initialValue: false,
        options: { layout: "switch" },
      }),
      defineField({
        name: "title",
        type: "string",
        title: "SEO Title",
        description: "The title of the page for search engines.",
        hidden: ({ document }) => isHomepageDocument(document),
      }),
      defineField({
        name: "description",
        type: "text",
        title: "Description",
        description: "A brief description of the page for search engines.",
        rows: 3,
        hidden: ({ document }) => isHomepageDocument(document),
      }),
      defineField({
        name: "sourceUrl",
        type: "url",
        title: "Source URL",
        description: "An https page on this site (apex or www) to screenshot for the share image. Required to use auto-generate.",
        validation: (R) => R.uri({ scheme: ["https"] }),
        hidden: ({ document }) => isHomepageDocument(document),
      }),
      defineField({
        name: "screenshotWaitSeconds",
        type: "number",
        title: "Screenshot wait (seconds)",
        description:
          "Extra time to wait after page load before capturing. Bump this for sites with intro animations or lazy content.",
        initialValue: 2,
        validation: (R) => R.min(0).max(10).integer(),
        hidden: ({ document }) => isHomepageDocument(document),
      }),
      defineField({
        name: "image",
        type: "image",
        title: "Image",
        description: "An image to represent the page for search engines.",
        options: {
          hotspot: true,
        },
        components: {
          input: SeoImageInput,
        },
        hidden: ({ document }) => isHomepageDocument(document),
      }),
    ],
  });
}
