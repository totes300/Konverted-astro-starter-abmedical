import { defineField } from "sanity";
import { createLinkField } from "../fields/create-link";
import { buildMediaPreview, createMediaField, mediaPreviewSelect } from "../fields/create-media";

export const heroSection = defineField({
  type: "object",
  name: "heroSection",
  title: "Hero",
  icon: () => <>🦸</>,
  fields: [
    defineField({
      name: "headline",
      type: "text",
      // A text, not a string: the line break an editor types is where the headline turns.
      rows: 2,
      title: "Headline",
      description: "The page's H1, set large over the photo. Break the line where the phrase should turn.",
      validation: (R) => R.required(),
    }),
    createLinkField({
      title: "Button",
      description: "Optional call to action at the bottom right, e.g. Learn more.",
    }),
    createMediaField({
      title: "Background",
      description:
        "Full-bleed photo or video behind the headline. Dark, low-key shots read best; set the hotspot on the subject.",
      validation: (R) => R.required(),
      options: { collapsed: false, collapsible: false },
    }),
  ],
  preview: {
    select: { ...mediaPreviewSelect("appMedia"), headline: "headline" },
    prepare: ({ headline, ...props }) => {
      return {
        ...buildMediaPreview(props),
        title: headline ?? "Hero",
        subtitle: "Hero",
      };
    },
  },
});
