import { defineArrayMember, defineField } from "sanity";
import { buildMediaPreview, createMediaField, mediaPreviewSelect } from "../fields/create-media";

const STAGE_LAYOUTS = [
  { title: "Split: copy and list beside one tall photo", value: "split" },
  { title: "Gallery: copy beside the list, two photos below", value: "gallery" },
  { title: "Centered: centred copy, then list, photo, photo and list", value: "centered" },
];

const stage = defineArrayMember({
  type: "object",
  name: "processStage",
  title: "Stage",
  fields: [
    defineField({
      name: "eyebrow",
      type: "string",
      title: "Eyebrow",
      description: "Names the stage, e.g. Design & Development. The stage number is added automatically.",
      validation: (R) => R.required(),
    }),
    defineField({ name: "headline", type: "text", rows: 2, title: "Headline", validation: (R) => R.required() }),
    defineField({ name: "text", type: "text", rows: 3, title: "Text" }),
    defineField({
      name: "items",
      type: "array",
      title: "Check list",
      description: "What the stage covers. The Centered layout splits the list in two, around the photos.",
      of: [defineArrayMember({ type: "string" })],
    }),
    defineField({
      name: "layout",
      type: "string",
      title: "Layout",
      initialValue: "split",
      options: { list: STAGE_LAYOUTS, layout: "radio" },
      validation: (R) => R.required(),
    }),
    createMediaField({
      name: "media",
      title: "Photo",
      description: "The main photo: the tall one in Split and Centered, the wide one in Gallery.",
      validation: (R) => R.required(),
    }),
    createMediaField({
      name: "secondaryMedia",
      title: "Second photo",
      description: "The narrow photo in Gallery; the photo above the second list in Centered.",
      hidden: ({ parent }) => parent?.layout === "split",
    }),
  ],
  preview: {
    select: { ...mediaPreviewSelect("media"), eyebrow: "eyebrow", layout: "layout" },
    prepare: ({ eyebrow, layout, ...props }) => ({
      ...buildMediaPreview(props),
      title: eyebrow ?? "Stage",
      subtitle: layout,
    }),
  },
});

export const processSection = defineField({
  type: "object",
  name: "processSection",
  title: "How we work",
  icon: () => <>🧭</>,
  fields: [
    defineField({ name: "eyebrow", type: "string", title: "Eyebrow", description: "Above the intro, e.g. All-in-one." }),
    defineField({
      name: "headline",
      type: "text",
      rows: 2,
      title: "Headline",
      description: "The intro statement, set large and centred.",
      validation: (R) => R.required(),
    }),
    defineField({ name: "lead", type: "text", rows: 3, title: "Intro text" }),
    defineField({
      name: "stages",
      type: "array",
      title: "Stages",
      description: "The steps of how we work, numbered in order. Alternate the layouts so the page keeps its rhythm.",
      validation: (R) => R.required().min(1),
      of: [stage],
    }),
  ],
  preview: {
    select: { title: "headline", stages: "stages" },
    prepare({ title, stages }) {
      return {
        title: title ?? "How we work",
        subtitle: `How we work · ${stages?.length ?? 0} stages`,
      };
    },
  },
});
