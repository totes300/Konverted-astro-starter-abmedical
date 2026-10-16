# Style guide (`/style-guide`)

The living reference for the AB Medical design system, rendered at [`/style-guide`](http://localhost:4321/style-guide) (noindex). It shows the real Tailwind tokens and the real components, so it cannot drift from what the sections render.

Source of truth for the design: the Figma file [Mallard](https://www.figma.com/design/P80tAiuATYXWjcZcz3TtnH/Mallard), frame `AB medical` (`13625:62061`).

## Where things live

| What | File |
| --- | --- |
| Page | `src/pages/style-guide.astro` |
| Content (swatches, type scale, spacing, sections built, changelog) | `src/features/style-guide/style-guide.ts` |
| Colors | `src/styles/colors.css` (named after the Figma variables; alpha variables are opacity modifiers, e.g. `white-75` → `text-white/75`) |
| Type scale, font families | `src/styles/typography.css`, `src/styles/fonts.css` |
| Gradients and other decoration utilities | `src/styles/decorations.css` |
| Layout (frame width, column, gutter), radii, blur | `src/styles/tailwind.css` |
| Primitives | `src/components/Eyebrow.astro`, `CheckList.astro`, `Button.astro` (`arrow`, `glass`), `Icon/icon-check-circle.svg`, `Emblem/` (the tilted emblem and its scroll motion) |
| Brand assets (logo, emblem soft + focus copies, photography) | `public/brand/` |

## Updating it with every new section

Building a section from Figma is not done until the style guide reflects it:

1. Pull the section with the Figma MCP (`get_design_context`) and list every font style, color, spacing, radius, effect and decoration it uses.
2. Anything new becomes a token first (`src/styles/*.css`), named after its Figma variable. A raw Figma value with no variable gets a descriptive name and `(raw value)` in the guide.
3. Add it to `style-guide.ts`: the swatch, type style or spacing entry, plus the section's ref (`S5`, ...) in `usedIn` on everything it uses, including existing entries.
4. A new reusable piece (button, card, list) becomes a component and gets a specimen in the Primitives chapter; a new ornament goes in Decoration; new photography or illustration in Imagery; a new animation gets its spec in Motion.
5. Set the section's `BUILT_SECTIONS` entry to `status: "built"` with its `component` path (add the entry first if it is new), and add a `CHANGELOG` entry (bump the minor version, today's date).
6. Open `/style-guide` and check the new entries render.

## Open questions from design

- No mobile navigation is designed: below `lg` the header shows the logo and Contact button only, and the links are hidden.
- The hero photo in Sanity is the Figma render (1440×860, upscaled from a smaller source). Replace it with the licensed full-resolution image.
- The header Contact button and the hero Learn more both point at the About page as placeholders; set their real targets in the Studio.
- Mobile type sizes are not in Figma; the `clamp()` minimums in `typography.css` are proposed.
- The logo exists only as a white PNG export. An SVG and a dark-on-light version are needed.
- The photography is watermarked Adobe Stock previews; license before launch.
- Button hover states are not designed; the current ones are proposed.
