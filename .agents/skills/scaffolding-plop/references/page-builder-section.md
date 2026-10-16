# Page Builder Section (Plop)

- **Generator**: "Page Builder Section". Creates a new page builder section (e.g. hero -> heroSection).
- **Prompt**: `name`: the section name; names are suffixed with "Section" (e.g. cta -> ctaSection).
- **Creates**: Schema in `sanity/schemas/page-sections/{{kebabCase name}}.tsx`; updates `sanity/schemas/page-sections/index.ts` (import + export); component in `src/features/page-builder/sections/{{pascalCase name}}.astro` (the name already carries the suffix, so `CtaSection.astro`); a `{{pascalCase name}}Q` query in `src/features/page-builder/queries.ts` (at `// PLOP: Add Section Query`); updates `src/features/page-builder/PageSections.astro` (import + `sections` registry entry at the `// PLOP: Add Import` / `// PLOP: Add Export` anchors). Records the section as the project's own (`scripts/trim-features/own.ts`), then runs `npm run sanity:typegen` and format.
- **Templates**: `templates/page-builder-section/schema.tsx.hbs`, `component.astro.hbs`, `query.ts.hbs`. The section component receives `docId` and `sectionKey` props and fetches its own section data with `loadQuery`.
- Reuse an existing section type when it fits; do not scaffold a new one without need.
- Agent Markdown: a section built from the standard factory fields (`appRichText`, `appMedia`, `appLink`, `headline`, `caption`) is served to agents automatically. If you add a **bespoke** content field that agents should read, also project it in `AgentMarkdownContentQuery` and render it in `src/features/agents/markdown.ts` (see the **agent-markdown** skill).
