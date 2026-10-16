import type { ComponentProps } from "astro/types";
import { definePreview } from "~/features/page-builder/section-preview";
import type Process from "./Process.astro";

const sampleList = ["Lorem ipsum dolor sit amet", "Consectetur adipiscing elit", "Sed do eiusmod tempor", "Incididunt ut labore"];

// The section runs several screens tall, so the thumbnail frames the intro and the first stage.
export const preview = definePreview<ComponentProps<typeof Process>>({
  height: 1500,
  props: (media) => ({
    eyebrow: "Lorem ipsum",
    headline: "Lorem ipsum dolor sit.",
    lead: "Lorem ipsum dolor sit amet consectetur. Nullam proin commodo ut iaculis. Curabitur ut pretium quis volutpat.",
    settings: { fullBleed: true },
    stages: [
      {
        key: "split",
        eyebrow: "Lorem ipsum",
        headline: "Lorem ipsum dolor sit amet consectetur",
        text: "Lorem ipsum dolor sit amet consectetur, adipiscing elit sed do eiusmod tempor.",
        items: sampleList,
        layout: "split",
        media: media.editorial(4 / 5),
      },
      {
        key: "gallery",
        eyebrow: "Dolor sit",
        headline: "Dolor sit amet consectetur adipiscing",
        text: "Lorem ipsum dolor sit amet consectetur, adipiscing elit sed do eiusmod tempor.",
        items: sampleList,
        layout: "gallery",
        media: media.editorial(16 / 9),
        secondaryMedia: media.editorial(4 / 5),
      },
      {
        key: "centered",
        eyebrow: "Amet consectetur",
        headline: "Amet consectetur adipiscing elit",
        text: "Lorem ipsum dolor sit amet consectetur, adipiscing elit sed do eiusmod tempor.",
        items: [...sampleList, ...sampleList],
        layout: "centered",
        media: media.editorial(4 / 5),
        secondaryMedia: media.editorial(6 / 5),
      },
    ],
  }),
});
