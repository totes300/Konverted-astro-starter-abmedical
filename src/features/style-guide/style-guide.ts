// The /style-guide content: every token, primitive and section the design system has adopted so far.
// Extend these lists whenever a new Figma section is built (see docs/style-guide.md).

export const FIGMA_FILE_URL = "https://www.figma.com/design/P80tAiuATYXWjcZcz3TtnH/Mallard";

export const figmaNodeUrl = (nodeId: string) => `${FIGMA_FILE_URL}?node-id=${nodeId.replace(":", "-")}`;

export type SectionRef = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

export type BuiltSection = {
  ref: SectionRef;
  name: string;
  figmaName: string;
  nodeId: string;
  ground: "dark" | "light";
  summary: string;
  uses: string[];
  /** `built` once the section renders on the site; `designed` while it exists only in Figma. */
  status: "built" | "designed";
  component?: string;
};

export const BUILT_SECTIONS: BuiltSection[] = [
  {
    ref: "S1",
    name: "Hero",
    figmaName: "Hero/3",
    nodeId: "13625:62062",
    ground: "dark",
    summary:
      "Full-bleed lab photograph under the overlaid site header, a hairline grid, the display headline (the page's H1) and a Learn more CTA. Plays the GSAP intro on load.",
    uses: [
      "text-display",
      "text-button",
      "text-button-sm",
      "bg-hero-fade",
      "Button glass",
      "Button arrow",
      "hairline/dark",
      "Motion: hero intro",
    ],
    status: "built",
    component: "page-builder/sections/HeroSection",
  },
  {
    ref: "S2",
    name: "All-in-one intro",
    figmaName: "Ints bucsut/2",
    nodeId: "13625:62084",
    ground: "dark",
    summary:
      "Built as direction 2: the hero's hairline grid carried on. Four columns, the last starting on the hero's divider; H1-size headline across three, intro in the fourth, numbered capabilities in a ruled row, the tilted emblem pulling into focus behind.",
    uses: [
      "text-heading-1",
      "text-body-lg",
      "text-body-lg (500)",
      "text-body",
      "Eyebrow dark",
      "bg-navy-glow",
      "Emblem",
      "hairline/dark",
      "Button arrow",
      "Motion: emblem pull",
    ],
    status: "built",
    component: "page-builder/sections/CapabilitiesSection",
  },
  {
    ref: "S3",
    name: "How we work: intro",
    figmaName: "Cim",
    nodeId: "13625:62199",
    ground: "light",
    summary:
      "Opens the How we work section (one Sanity item with S4–S6): centred eyebrow, display headline and a 704px lead on the white ground, 220px below the dark section above.",
    uses: ["text-display", "text-body-lg", "Eyebrow light"],
    status: "built",
    component: "page-builder/sections/ProcessSection",
  },
  {
    ref: "S4",
    name: "How we work: stage 01, split",
    figmaName: "section",
    nodeId: "13625:62207",
    ground: "light",
    summary:
      "Stage layout `split`: numbered eyebrow, H3, lead and a hairline check list beside a 4:5 photo card. Two columns from md.",
    uses: ["text-heading-3", "text-body-lg", "text-body", "Eyebrow light", "CheckList", "rounded-16"],
    status: "built",
    component: "page-builder/sections/ProcessSection",
  },
  {
    ref: "S5",
    name: "How we work: stage 02, gallery",
    figmaName: "section",
    nodeId: "13625:62250",
    ground: "light",
    summary:
      "Stage layout `gallery`: copy beside the check list, then a wide and a narrow photo card on the same 823 / 505 columns.",
    uses: ["text-heading-3", "text-body-lg", "Eyebrow light", "CheckList", "rounded-16", "bg-black-01/10"],
    status: "built",
    component: "page-builder/sections/ProcessSection",
  },
  {
    ref: "S6",
    name: "How we work: stage 03, centered",
    figmaName: "section",
    nodeId: "13625:62288",
    ground: "light",
    summary: "Stage layout `centered`: centred copy, then half the list, a tall photo, and a second photo above the other half.",
    uses: ["text-heading-3", "text-body-lg", "Eyebrow light", "CheckList", "rounded-16", "bg-black-01/10"],
    status: "built",
    component: "page-builder/sections/ProcessSection",
  },
];

export type Swatch = {
  name: string;
  token: string;
  swatchClass: string;
  hex: string;
  figma: string;
  usage: string;
  usedIn: SectionRef[];
  dark?: boolean;
};

export type SwatchGroup = { title: string; description: string; swatches: Swatch[] };

export const COLOR_GROUPS: SwatchGroup[] = [
  {
    title: "Core",
    description: "The grounds and inks every section is built on. Dark sections sit on ink and navy, light ones on white.",
    swatches: [
      {
        name: "Black 01",
        token: "black-01",
        swatchClass: "bg-black-01",
        hex: "#1D1D1D",
        figma: "black-01 · Text/primary",
        usage: "Primary text on light grounds, check-circle icon.",
        usedIn: ["S3", "S4", "S5", "S6"],
        dark: true,
      },
      {
        name: "Ink",
        token: "ink",
        swatchClass: "bg-ink",
        hex: "#090A13",
        figma: "(raw value, gradients)",
        usage: "Darkest ground: hero fade and the base of the navy glow.",
        usedIn: ["S1", "S2"],
        dark: true,
      },
      {
        name: "Navy blue",
        token: "navy-blue",
        swatchClass: "bg-navy-blue",
        hex: "#07141E",
        figma: "navy-blue",
        usage: "Arrow glyph inside the white CTA tile; the transparent end of the hero fade.",
        usedIn: ["S1"],
        dark: true,
      },
      {
        name: "White",
        token: "white",
        swatchClass: "bg-white",
        hex: "#FFFFFF",
        figma: "white-100 · Text/alternate",
        usage: "Text on dark grounds, the CTA arrow tile, light section ground.",
        usedIn: ["S1", "S2", "S3", "S4", "S5", "S6"],
      },
      {
        name: "Beige 01",
        token: "beige-01",
        swatchClass: "bg-beige-01",
        hex: "#FDF8F2",
        figma: "beige-01",
        usage: "Navigation links over the hero photo: a warm white that sits softer than pure white.",
        usedIn: ["S1"],
      },
      {
        name: "Gray 02",
        token: "gray-02",
        swatchClass: "bg-gray-02",
        hex: "#DCDAD7",
        figma: "gray-02",
        usage: "Hero frame fill behind the photo (shows while the image loads).",
        usedIn: ["S1"],
      },
    ],
  },
  {
    title: "Accent",
    description: "Blue is used sparingly: the eyebrow marker square, and the navy glow. Never for body text.",
    swatches: [
      {
        name: "Blue 02",
        token: "blue-02",
        swatchClass: "bg-blue-02",
        hex: "#33519F",
        figma: "blue-02",
        usage: "Eyebrow marker on dark grounds.",
        usedIn: ["S2"],
        dark: true,
      },
      {
        name: "Blue bright",
        token: "blue-bright",
        swatchClass: "bg-blue-bright",
        hex: "#547ADE",
        figma: "(raw value, unnamed in Figma)",
        usage: "Eyebrow marker on light grounds.",
        usedIn: ["S3", "S4", "S5", "S6"],
        dark: true,
      },
      {
        name: "Navy 800",
        token: "navy-800",
        swatchClass: "bg-navy-800",
        hex: "#17244C",
        figma: "(gradient stop)",
        usage: "Brightest stop of the navy glow.",
        usedIn: ["S2"],
        dark: true,
      },
      {
        name: "Navy 900",
        token: "navy-900",
        swatchClass: "bg-navy-900",
        hex: "#10172F",
        figma: "(gradient stop)",
        usage: "Middle stop of the navy glow.",
        usedIn: ["S2"],
        dark: true,
      },
    ],
  },
  {
    title: "Text",
    description: "Semantic text colors from the Figma Text/* variables.",
    swatches: [
      {
        name: "Primary",
        token: "black-01",
        swatchClass: "bg-black-01",
        hex: "#1D1D1D",
        figma: "Text/primary",
        usage: "Headlines and body on light grounds.",
        usedIn: ["S3", "S4", "S5", "S6"],
        dark: true,
      },
      {
        name: "Secondary",
        token: "gray-text",
        swatchClass: "bg-gray-text",
        hex: "#737373",
        figma: "Text/secondary",
        usage: "Defined in Figma; not used by sections 1–4 yet.",
        usedIn: [],
        dark: true,
      },
      {
        name: "Alternate",
        token: "white",
        swatchClass: "bg-white",
        hex: "#FFFFFF",
        figma: "Text/alternate",
        usage: "Headlines and body on dark grounds.",
        usedIn: ["S1", "S2"],
      },
    ],
  },
];

export type AlphaStep = { label: string; figma: string; swatchClass: string; textClass: string; usage: string };

export const WHITE_ALPHA: AlphaStep[] = [
  { label: "white", figma: "white-100", swatchClass: "bg-white", textClass: "text-white", usage: "Headlines, CTA" },
  { label: "white/75", figma: "white-75", swatchClass: "bg-white/75", textClass: "text-white/75", usage: "Lead copy on dark" },
  {
    label: "white/50",
    figma: "white-50",
    swatchClass: "bg-white/50",
    textClass: "text-white/50",
    usage: "Supporting copy on dark",
  },
  { label: "white/25", figma: "white-25", swatchClass: "bg-white/25", textClass: "text-white/25", usage: "Hairlines on dark" },
];

export const BLACK_ALPHA: AlphaStep[] = [
  { label: "black-01", figma: "black-01", swatchClass: "bg-black-01", textClass: "text-black-01", usage: "Primary text" },
  {
    label: "black-01/75",
    figma: "black-01-75",
    swatchClass: "bg-black-01/75",
    textClass: "text-black-01/75",
    usage: "Defined, unused",
  },
  {
    label: "black-01/50",
    figma: "black-01-50",
    swatchClass: "bg-black-01/50",
    textClass: "text-black-01/50",
    usage: "Eyebrow label on light",
  },
  {
    label: "black-01/25",
    figma: "black-01-25",
    swatchClass: "bg-black-01/25",
    textClass: "text-black-01/25",
    usage: "Glass button fill",
  },
  {
    label: "black-01/15",
    figma: "black-01-15",
    swatchClass: "bg-black-01/15",
    textClass: "text-black-01/15",
    usage: "Hairlines on light",
  },
  {
    label: "black-01/10",
    figma: "black-01-10",
    swatchClass: "bg-black-01/10",
    textClass: "text-black-01/10",
    usage: "Image card placeholder",
  },
];

export type TypeStyle = {
  name: string;
  token: string;
  specimenClass: string;
  figma: string;
  family: string;
  weight: string;
  size: string;
  lineHeight: string;
  tracking: string;
  sample: string;
  usedIn: SectionRef[];
  note?: string;
};

export const TYPE_SCALE: TypeStyle[] = [
  {
    name: "Display",
    token: "text-display",
    specimenClass: "text-display",
    figma: "heading-style-display",
    family: "PP Neue Montreal",
    weight: "400",
    size: "72 / 40px",
    lineHeight: "110%",
    tracking: "0",
    sample: "Engineering a New Future",
    usedIn: ["S1", "S3"],
  },
  {
    name: "Heading 1",
    token: "text-heading-1",
    specimenClass: "text-heading-1",
    figma: "heading-style-h1",
    family: "PP Neue Montreal",
    weight: "400",
    size: "56 / 36px",
    lineHeight: "110%",
    tracking: "0",
    sample: "Medical device partner",
    usedIn: [],
  },
  {
    name: "Heading 2",
    token: "text-heading-2",
    specimenClass: "text-heading-2",
    figma: "heading-style-h2",
    family: "PP Neue Montreal",
    weight: "400",
    size: "48 / 32px",
    lineHeight: "120%",
    tracking: "0",
    sample: "From concept to production",
    usedIn: [],
  },
  {
    name: "Heading 3",
    token: "text-heading-3",
    specimenClass: "text-heading-3",
    figma: "heading-style-h3",
    family: "PP Neue Montreal",
    weight: "400",
    size: "40 / 28px",
    lineHeight: "120%",
    tracking: "0",
    sample: "Complete Product Development",
    usedIn: ["S2", "S4", "S5", "S6"],
  },
  {
    name: "Heading 4",
    token: "text-heading-4",
    specimenClass: "text-heading-4",
    figma: "heading-style-h4",
    family: "PP Neue Montreal",
    weight: "400",
    size: "32 / 24px",
    lineHeight: "130%",
    tracking: "0",
    sample: "Design verification",
    usedIn: [],
  },
  {
    name: "Body XL",
    token: "text-body-xl",
    specimenClass: "text-body-xl",
    figma: "text-size-xlarge-regular",
    family: "PP Neue Montreal",
    weight: "400",
    size: "22 / 18px",
    lineHeight: "140%",
    tracking: "0",
    sample: "Lead paragraph on dark grounds, set in white/75.",
    usedIn: ["S2"],
  },
  {
    name: "Body LG",
    token: "text-body-lg",
    specimenClass: "text-body-lg",
    figma: "text-size-large-regular",
    family: "PP Neue Montreal",
    weight: "400",
    size: "20 / 18px",
    lineHeight: "140%",
    tracking: "0",
    sample: "Concept through production-ready design, with FDA-aligned design controls.",
    usedIn: ["S3", "S4", "S5", "S6"],
  },
  {
    name: "Body LG Medium",
    token: "text-body-lg font-medium",
    specimenClass: "text-body-lg font-medium",
    figma: "text-size-large-medium",
    family: "PP Neue Montreal",
    weight: "500",
    size: "20 / 18px",
    lineHeight: "140%",
    tracking: "0",
    sample: "Design & Development",
    usedIn: ["S2"],
  },
  {
    name: "Body",
    token: "text-body",
    specimenClass: "text-body",
    figma: "text-size-regular-regular",
    family: "PP Neue Montreal",
    weight: "400",
    size: "16px",
    lineHeight: "150%",
    tracking: "0",
    sample: "Mechanical and electromechanical engineering",
    usedIn: ["S2", "S4", "S5", "S6"],
  },
  {
    name: "Body Medium (nav)",
    token: "text-body font-medium",
    specimenClass: "text-body font-medium",
    figma: "text-size-regular-medium · Text/Regular/Medium",
    family: "PP Neue Montreal",
    weight: "500",
    size: "16px",
    lineHeight: "150%",
    tracking: "0",
    sample: "Services · Industries · About",
    usedIn: ["S1"],
  },
  {
    name: "Body SM",
    token: "text-body-sm",
    specimenClass: "text-body-sm",
    figma: "text-size-tiny-regular",
    family: "PP Neue Montreal",
    weight: "400",
    size: "12px",
    lineHeight: "150%",
    tracking: "0",
    sample: "Small print, legal and meta copy.",
    usedIn: [],
  },
  {
    name: "Label (eyebrow)",
    token: "font-label text-label uppercase",
    specimenClass: "font-label text-label uppercase",
    figma: "caption",
    family: "Azeret Mono",
    weight: "400",
    size: "14 / 12px",
    lineHeight: "100%",
    tracking: "8%",
    sample: "All-in-one",
    usedIn: ["S2", "S3", "S4", "S5", "S6"],
  },
  {
    name: "Button",
    token: "text-button uppercase",
    specimenClass: "text-button uppercase",
    figma: "button-text-small",
    family: "PP Neue Montreal",
    weight: "400",
    size: "14px",
    lineHeight: "100%",
    tracking: "8%",
    sample: "Learn more",
    usedIn: ["S1"],
  },
  {
    name: "Button SM",
    token: "text-button-sm uppercase",
    specimenClass: "text-button-sm uppercase",
    figma: "button-text-tiny",
    family: "PP Neue Montreal",
    weight: "400",
    size: "12px",
    lineHeight: "100%",
    tracking: "8%",
    sample: "→ Contact",
    usedIn: ["S1"],
  },
];

export type SpaceStep = { value: number; widthClass: string; usage: string };

export const SPACE_SCALE: SpaceStep[] = [
  { value: 4, widthClass: "w-4", usage: "Title → description in a capability column" },
  { value: 8, widthClass: "w-8", usage: "Eyebrow marker size" },
  { value: 10, widthClass: "w-10", usage: "Eyebrow marker → label" },
  { value: 12, widthClass: "w-12", usage: "Check icon → text, list row padding, glass button y-padding" },
  { value: 16, widthClass: "w-16", usage: "Heading → lead, CTA label → arrow tile" },
  { value: 24, widthClass: "w-24", usage: "Heading → lead on dark, hero title top padding" },
  { value: 32, widthClass: "w-32", usage: "Hero inner padding, section inner padding, arrow tile size" },
  { value: 36, widthClass: "w-36", usage: "Eyebrow → heading block, nav link gap" },
  { value: 48, widthClass: "w-48", usage: "Hero title bottom padding" },
  { value: 56, widthClass: "w-56", usage: "Copy block → check list" },
  { value: 64, widthClass: "w-64", usage: "Dark section top / side padding" },
  { value: 72, widthClass: "w-72", usage: "Centered statement side padding" },
  { value: 92, widthClass: "w-92", usage: "Capability column gap" },
  { value: 124, widthClass: "w-124", usage: "Copy column → photo card gap" },
];

export type RhythmStep = { value: number; heightClass: string; usage: string };

export const SECTION_RHYTHM: RhythmStep[] = [
  { value: 0, heightClass: "h-0", usage: "S1 → S2: dark sections stack flush" },
  { value: 96, heightClass: "h-96", usage: "How we work: intro → first stage" },
  { value: 164, heightClass: "h-164", usage: "How we work → the section after it" },
  { value: 196, heightClass: "h-196", usage: "How we work: stage → stage" },
  { value: 220, heightClass: "h-220", usage: "Dark section → How we work intro (Figma stacks a 96 and a 124 spacer)" },
];

export type Radius = { token: string; boxClass: string; value: string; usage: string };

export const RADII: Radius[] = [
  { token: "rounded-4", boxClass: "rounded-4", value: "4px", usage: "Buttons, arrow tile" },
  { token: "rounded-8", boxClass: "rounded-8", value: "8px", usage: "Button hit area, statement container" },
  { token: "rounded-16", boxClass: "rounded-16", value: "16px", usage: "Photo cards" },
];

export type MotionStep = { target: string; property: string; from: string; duration: string; delay: string; ease: string };

/** The hero's page-load intro (`HeroSection/HeroElement.ts`), times in seconds from the start of the timeline. */
export const HERO_INTRO: MotionStep[] = [
  {
    target: "Horizontal hairlines",
    property: "scaleX",
    from: "0 → 1",
    duration: "1.4s",
    delay: "0, +0.12 each",
    ease: "power3.inOut",
  },
  { target: "Vertical divider", property: "scaleY", from: "0 → 1", duration: "1.1s", delay: "0.45", ease: "power3.inOut" },
  {
    target: "Headline lines (SplitText, masked)",
    property: "yPercent",
    from: "110 → 0",
    duration: "1.2s",
    delay: "0.5, +0.12 each",
    ease: "reveal",
  },
  { target: "CTA (masked)", property: "yPercent", from: "110 → 0", duration: "1.0s", delay: "0.85", ease: "reveal" },
];

/** The emblem behind dark sections (`src/components/Emblem/EmblemElement.ts`), mapped on native scroll over its pass across the screen. */
export const EMBLEM_MOTION: MotionStep[] = [
  {
    target: "Focus copy (blur 16) over the soft copy (blur 50)",
    property: "opacity",
    from: "0 → 0.75 → 0",
    duration: "scroll",
    delay: "peaks mid-screen",
    ease: "smoothstep",
  },
  { target: "Emblem", property: "translateY", from: "28 → −28 px", duration: "scroll", delay: "whole pass", ease: "linear" },
  { target: "Emblem", property: "rotate", from: "−1.5° → 1.5°", duration: "scroll", delay: "whole pass", ease: "linear" },
];

export type ChangelogEntry = { version: string; date: string; changes: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4",
    date: "2026-10-16",
    changes: [
      "S3–S6 built as one processSection (How we work): the centred intro and three numbered stages on one white ground, editable as a single Sanity item.",
      "Stage layouts: split, gallery and centered, picked per stage; every stage shares the numbered eyebrow (01 / Design & Development) that matches S2's numbers.",
      "Rhythm: 220 above the intro, 96 to the first stage, 196 between stages, 164 below; split stages go two-column from md.",
    ],
  },
  {
    version: "0.3",
    date: "2026-10-16",
    changes: [
      "S2 built as the capabilitiesSection: direction 2 (hero grid continued), chosen from the explorations canvas.",
      "Emblem: the tilted AB emblem replaces the flattened mark, as a soft and a focus copy; the Emblem component pulls it toward focus and drifts it on scroll (opacity and transform only).",
      "Rhythm: sections now own the space between them. SectionFrame adds a 40/60px margin by default (the old 80/120 gap, halved per side); dark sections pass flush to join (S1 → S2).",
      "Capabilities headlines keep the editor's line break from lg up and wrap naturally on phones.",
    ],
  },
  {
    version: "0.2",
    date: "2026-10-16",
    changes: [
      "S1 Hero built: the heroSection page builder section (headline, button, background media) is the homepage's only section.",
      "Site header rebuilt to the design: overlays the page, logo, Body Medium beige-01 links, frosted Contact button (new Site → Header field).",
      "Motion: the GSAP hero intro (hairlines draw, headline lines rise from SplitText masks, CTA follows).",
      "Layout: --header-height is 68px at every width; the header and hero run full width on the page gutter.",
    ],
  },
  {
    version: "0.1",
    date: "2026-10-16",
    changes: [
      "First version, covering Figma sections 1–4 (Hero, All-in-one intro, Centered statement, Service split).",
      "Tokens added: AB Medical palette, PP Neue Montreal + Azeret Mono, the display/heading/body/label/button type scale, blur-16, bg-hero-fade, bg-navy-glow.",
      "Layout: 1440px design frame, 1360px content column, 40px desktop gutter.",
      "Primitives: Eyebrow, CheckList, Button variants arrow and glass, check-circle icon.",
    ],
  },
];
