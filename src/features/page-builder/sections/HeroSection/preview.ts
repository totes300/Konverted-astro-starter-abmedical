import type { ComponentProps } from "astro/types";
import { definePreview } from "~/features/page-builder/section-preview";
import { sampleCta } from "~/features/page-builder/section-preview-samples";
import type Hero from "./Hero.astro";

// Full bleed, as the hero always runs; one screen tall, so the default frame is the capture viewport itself.
export const preview = definePreview<ComponentProps<typeof Hero>>({
  props: (media) => ({
    headline: "Lorem ipsum dolor\nsit amet consectetur",
    cta: sampleCta("Learn more"),
    media: media.editorial(16 / 9),
    settings: { fullBleed: true },
  }),
});
