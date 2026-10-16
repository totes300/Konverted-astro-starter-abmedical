/**
 * The brand ramp the Studio offers for content colour. Semantic tokens are excluded: they carry meaning, not a colour.
 * `name` is stored, not the hex, so editing the token in the app's stylesheet reaches published content.
 */
export type BrandColor = {
  name: string;
  title: string;
  swatch: string;
};

export const BRAND_COLORS: readonly BrandColor[] = [
  { name: "brand-black", title: "Black", swatch: "#000" },
  { name: "brand-white", title: "White", swatch: "#fff" },
  { name: "brand-off-white", title: "Off White", swatch: "#f2f0ed" },
  { name: "brand-grey", title: "Grey", swatch: "#8a8a8a" },
  { name: "brand-accent", title: "Accent", swatch: "#ff9100" },
];

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function findBrandColor(name: string | undefined): BrandColor | undefined {
  return BRAND_COLORS.find((color) => color.name === name);
}

/** Content stored before the palette holds raw hex; a strict one carries nothing that could break out of a `style` value. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** What the Studio paints for a stored colour: a palette name's swatch, a strict hex as itself, otherwise nothing. */
export function resolveColorSwatch(value: unknown): string | undefined {
  const stored = typeof value === "string" ? value.trim() : "";

  return findBrandColor(stored)?.swatch ?? (isHexColor(stored) ? stored : undefined);
}
