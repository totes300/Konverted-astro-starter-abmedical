import type { ComponentProps } from "astro/types";
import { definePreview } from "~/features/page-builder/section-preview";
import { sampleCta } from "~/features/page-builder/section-preview-samples";
import type Capabilities from "./Capabilities.astro";

const sampleItem = (key: string, title: string) => ({
  key,
  title,
  description: "Lorem ipsum dolor sit amet consectetur, adipiscing elit sed do eiusmod tempor incididunt.",
});

// Full bleed, as the section always runs: the grid only reads against the hero's divider at full width.
export const preview = definePreview<ComponentProps<typeof Capabilities>>({
  height: 800,
  props: {
    eyebrow: "Lorem ipsum",
    headline: "Lorem ipsum dolor sit amet\nconsectetur adipiscing",
    lead: "Lorem ipsum dolor sit amet consectetur. Nullam proin commodo ut iaculis. Curabitur ut pretium quis volutpat.",
    items: [
      sampleItem("one", "Lorem ipsum dolor"),
      sampleItem("two", "Sit amet consectetur"),
      sampleItem("three", "Adipiscing elit sed"),
    ],
    cta: sampleCta("Learn more"),
    settings: { fullBleed: true },
  },
});
