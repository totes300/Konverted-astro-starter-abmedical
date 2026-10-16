import { stegaClean } from "@sanity/client/stega";
import { type Screen, screens } from "~/features/dom/constants";
import { parseResponsiveValues } from "~/features/dom/utils";
import { safeHref } from "~/features/sanity/link/safe-href";

export function parseAspectRatio(ratio: string | number) {
  if (typeof ratio === "number") {
    return ratio;
  }

  const [w = 1, h = 1] = ratio.split(/[:/]/).map(Number);
  return w / h;
}

export function createResponsiveRatios(aspectRatio: string | number) {
  const ratio = parseResponsiveValues(String(aspectRatio));
  const breakpoints = Object.keys(screens) as [Screen];

  const result: Record<string, string> = {};

  const defaultValue = parseAspectRatio(ratio.DEFAULT?.value);
  result["--mx-ratio-DEFAULT"] = String(defaultValue);

  // We want to inherit the previous value if a screen is missing.
  let previousValue = defaultValue;

  for (const breakpoint of breakpoints) {
    const currentValue = parseAspectRatio(ratio[breakpoint]?.value || previousValue);
    result[`--mx-ratio-${breakpoint}`] = String(currentValue);
    previousValue = currentValue;
  }

  return {
    styles: result,
    className: [
      "aspect-[var(--mx-ratio)]",
      "[--mx-ratio:var(--mx-ratio-DEFAULT)]",
      "sm:[--mx-ratio:var(--mx-ratio-sm)]",
      "md:[--mx-ratio:var(--mx-ratio-md)]",
      "lg:[--mx-ratio:var(--mx-ratio-lg)]",
      "xl:[--mx-ratio:var(--mx-ratio-xl)]",
      "2xl:[--mx-ratio:var(--mx-ratio-2xl)]",
    ],
  };
}

// Wide enough for any real asset, narrow enough that a stored value cannot stretch a box across the page.
const MIN_ASPECT_RATIO = 1 / 20;
const MAX_ASPECT_RATIO = 20;

const LQIP_DATA_URI = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A CMS aspect ratio fit for an inline `style`: a positive finite number, clamped, or undefined for anything else. */
export function cssAspectRatio(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return Math.min(Math.max(value, MIN_ASPECT_RATIO), MAX_ASPECT_RATIO);
}

/** An asset's lqip when it is a base64 image data URI, the only shape that may land inside a CSS `url(...)`. */
export function safeLqip(value: unknown): string | undefined {
  return typeof value === "string" && LQIP_DATA_URI.test(value) ? value : undefined;
}

/** A CMS video URL fit for `<source src>`, or undefined: an API write skips the Studio's URL rule, so `safeHref` decides here. */
export function safeVideoSrc(value: unknown): string | undefined {
  return typeof value === "string" ? (safeHref(stegaClean(value)) ?? undefined) : undefined;
}
