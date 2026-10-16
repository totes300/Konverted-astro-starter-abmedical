import { defineArrayMember, defineField } from "sanity";
import { createLinkField } from "../fields/create-link";

export const capabilitiesSection = defineField({
  type: "object",
  name: "capabilitiesSection",
  title: "Capabilities",
  icon: () => <>🧩</>,
  fields: [
    defineField({
      name: "eyebrow",
      type: "string",
      title: "Eyebrow",
      description: "The short label above the headline, e.g. All-in-one.",
    }),
    defineField({
      name: "headline",
      type: "text",
      // A text, not a string: the line break an editor types is where the headline turns.
      rows: 2,
      title: "Headline",
      validation: (R) => R.required(),
    }),
    defineField({
      name: "lead",
      type: "text",
      rows: 3,
      title: "Intro",
      description: "Sits in the narrow right-hand column, under the hero's divider line. Two or three sentences.",
    }),
    defineField({
      name: "items",
      type: "array",
      title: "Capabilities",
      description: "Up to three, numbered in order across the grid.",
      validation: (R) => R.required().min(1).max(3),
      of: [
        defineArrayMember({
          type: "object",
          name: "capability",
          fields: [
            defineField({ name: "title", type: "string", title: "Title", validation: (R) => R.required() }),
            defineField({ name: "description", type: "text", rows: 3, title: "Description" }),
          ],
          preview: { select: { title: "title", subtitle: "description" } },
        }),
      ],
    }),
    createLinkField({
      title: "Link",
      description: "Optional, bottom right of the grid, e.g. All capabilities.",
    }),
  ],
  preview: {
    select: { title: "headline", items: "items" },
    prepare({ title, items }) {
      return {
        title: title ?? "Capabilities",
        subtitle: `Capabilities · ${items?.length ?? 0} items`,
      };
    },
  },
});
