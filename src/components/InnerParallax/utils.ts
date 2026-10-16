import { type Screen, screens } from "~/features/dom/constants";
import { parseResponsiveValues } from "~/features/dom/utils";

function normalizeValue(value: string): string {
  const trimmed = value.trim();

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  return trimmed;
}

// A missing screen inherits the previous breakpoint, mirroring how Tailwind's min-width variants cascade.
function cascade(shorthand: string, normalize: (value: string) => string) {
  const parsed = parseResponsiveValues(shorthand);
  const breakpoints = Object.keys(screens) as Screen[];
  const values = { DEFAULT: normalize(parsed.DEFAULT?.value ?? shorthand) } as Record<Screen | "DEFAULT", string>;

  let previousValue = values.DEFAULT;

  for (const breakpoint of breakpoints) {
    previousValue = parsed[breakpoint]?.value ? normalize(parsed[breakpoint].value) : previousValue;
    values[breakpoint] = previousValue;
  }

  return values;
}

function toStyles(name: string, values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([screen, value]) => [`--${name}-${screen}`, value]));
}

/**
 * Turns a responsive overflow shorthand ("60 lg:120") into `--parallax-overflow-*` properties plus the
 * per-breakpoint classes that promote them, so the responsive value stays pure CSS.
 */
export function createResponsiveOverflow(overflow: string | number) {
  const overflowString = typeof overflow === "number" ? `${overflow}px` : overflow;

  return {
    styles: toStyles("parallax-overflow", cascade(overflowString, normalizeValue)),
    classes: [
      "[--parallax-overflow:var(--parallax-overflow-DEFAULT)]",
      "sm:[--parallax-overflow:var(--parallax-overflow-sm)]",
      "md:[--parallax-overflow:var(--parallax-overflow-md)]",
      "lg:[--parallax-overflow:var(--parallax-overflow-lg)]",
      "xl:[--parallax-overflow:var(--parallax-overflow-xl)]",
      "2xl:[--parallax-overflow:var(--parallax-overflow-2xl)]",
    ],
  };
}

/** Turns a responsive axis shorthand ("y lg:x") into a `--parallax-x` flag: 1 slides sideways, 0 vertically. */
export function createResponsiveDirection(direction: string) {
  return {
    styles: toStyles(
      "parallax-x",
      cascade(direction, (value) => (value.trim() === "x" ? "1" : "0"))
    ),
    classes: [
      "[--parallax-x:var(--parallax-x-DEFAULT)]",
      "sm:[--parallax-x:var(--parallax-x-sm)]",
      "md:[--parallax-x:var(--parallax-x-md)]",
      "lg:[--parallax-x:var(--parallax-x-lg)]",
      "xl:[--parallax-x:var(--parallax-x-xl)]",
      "2xl:[--parallax-x:var(--parallax-x-2xl)]",
    ],
  };
}
