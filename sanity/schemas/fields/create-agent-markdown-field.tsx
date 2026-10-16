import { type BooleanInputProps, defineField } from "sanity";
import { AgentMarkdownInput } from "../../inputs/generate-text-input";

// Serving treats an unset toggle as on, so the switch shows it that way too (documents created before the field existed).
function DefaultOnSwitchInput(props: BooleanInputProps) {
  return props.renderDefault({ ...props, value: props.value ?? true });
}

export function createAgentMarkdownField({ group }: { group?: string } = {}) {
  return defineField({
    name: "agentMarkdown",
    type: "object",
    title: "Agent Markdown",
    description:
      "A Markdown version of this page served to AI agents that request it (Accept: text/markdown). Draft it from the page's content with one click, then publish. It is served as-is and does not update on its own, so regenerate when the page changes.",
    group,
    options: {
      collapsed: false,
      collapsible: false,
    },
    fields: [
      defineField({
        name: "enabled",
        type: "boolean",
        title: "Serve Markdown to agents",
        description:
          "When on, the published Markdown below is served to AI agents that request this page with an Accept: text/markdown header. Turn off to keep this page HTML-only. Nothing is served for a noindex or password-protected page, or for any page while the whole site is password protected, and the Backfill under Settings skips password-protected pages.",
        initialValue: true,
        options: { layout: "switch" },
        components: { input: DefaultOnSwitchInput },
      }),
      defineField({
        name: "content",
        type: "text",
        rows: 20,
        title: "Content",
        description:
          "Markdown served to agents, required while serving is on. Click Generate to draft it from this page's current content, then edit and publish. Nothing is served until you publish, and it does not refresh on its own, so regenerate after you change the page.",
        components: { input: AgentMarkdownInput },
        validation: (R) =>
          R.custom((value, { parent }) => {
            if ((parent as { enabled?: boolean } | undefined)?.enabled === false) {
              return true;
            }

            return typeof value === "string" && value.trim() !== ""
              ? true
              : "Generate or write the Markdown, or turn off serving to agents.";
          }),
      }),
    ],
  });
}
