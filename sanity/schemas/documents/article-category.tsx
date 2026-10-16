import { defineField, defineType } from "sanity";
import { sanityConfig } from "../../config";

// The blog filter reads the slug from its URL and drops one outside a bounded charset or length.
const SLUG = /^[a-z0-9-]+$/;
const MAX_SLUG_LENGTH = 64;

export const articleCategory = defineType({
  __experimental_formPreviewTitle: false,
  name: "articleCategory",
  type: "document",
  title: "Article Category",
  icon: () => <>🔍</>,
  fields: [
    defineField({
      name: "name",
      type: "string",
      title: "Name",
      validation: (R) =>
        R.required().custom(async (name, context) => {
          if (!name || typeof name !== "string") {
            return true;
          }

          const client = context.getClient({ apiVersion: sanityConfig.apiVersion });
          const docId = context.document?._id;
          const baseId = docId?.replace(/^drafts\./, "") ?? "";
          const idsToExclude = baseId ? [docId, baseId].filter(Boolean) : [];

          const query =
            idsToExclude.length > 0
              ? `count(*[_type == "articleCategory" && name == $name && !(_id in $excludeIds)])`
              : `count(*[_type == "articleCategory" && name == $name])`;

          const count = await client.fetch(query, {
            name: name.trim(),
            excludeIds: idsToExclude,
          });

          return count === 0 || "An article category with this name already exists.";
        }),
    }),
    defineField({
      name: "slug",
      type: "slug",
      title: "Slug",
      description: "The value this category uses in the blog index URL, e.g. `/blog?category=engineering`.",
      options: { source: "name", maxLength: MAX_SLUG_LENGTH },
      validation: (R) =>
        R.required().custom((slug) => {
          const current = slug?.current;

          if (!current) {
            return true;
          }

          if (current.length > MAX_SLUG_LENGTH) {
            return `Keep the slug to ${MAX_SLUG_LENGTH} characters or fewer.`;
          }

          return SLUG.test(current) || "Use lowercase letters, digits and hyphens only (e.g., `design-systems`).";
        }),
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "slug.current" },
  },
});
