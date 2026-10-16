import { stegaClean } from "@sanity/client/stega";
import { findBrandColor, isHexColor } from "~/sanity/colors";

/** A palette name resolves to its token and a strict hex (older content) to itself; nothing else reaches `style`, since API writes skip the picker. */
export function tokenColor(value: string | null | undefined): string | undefined {
  const cleaned = stegaClean(value ?? "").trim();
  const color = findBrandColor(cleaned);

  if (color) {
    return `var(--color-${color.name})`;
  }

  return isHexColor(cleaned) ? cleaned : undefined;
}
