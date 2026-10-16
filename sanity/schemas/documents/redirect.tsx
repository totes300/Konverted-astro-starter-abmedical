import { defineField, defineType, type StringRule } from "sanity";
import { sanityConfig } from "../../config";
import { type RedirectPathRules, redirectFromProblem, redirectLoops, redirectToProblem } from "./redirect-path";

const redirectStatus = {
  301: "301 (Permanent)",
  302: "302 (Temporary)",
};

const PATH_RULES: RedirectPathRules = {
  patterns: sanityConfig.redirectPatterns,
  reservedPaths: ["/api", ...sanityConfig.reservedStudioPaths],
};

function redirectPathValidation(field: "from" | "to") {
  return (R: StringRule) => {
    return R.required().custom((value: string | undefined, { parent }) => {
      if (!value) {
        return true;
      }

      const entry = parent as { from?: string; to?: string } | undefined;
      const problem =
        field === "from" ? redirectFromProblem(value, PATH_RULES) : redirectToProblem(value, entry?.from, PATH_RULES);

      if (problem) {
        return problem;
      }

      const from = field === "from" ? value : entry?.from;
      const to = field === "to" ? value : entry?.to;

      if (from && to && redirectLoops(from, to)) {
        return 'The "From" and "To" paths name the same page (letter case, an anchor, a query or a trailing "/" does not change it), so the redirect would loop.';
      }

      return true;
    });
  };
}

export const redirect = defineType({
  __experimental_formPreviewTitle: false,
  name: "redirect",
  type: "document",
  title: "Redirect",
  icon: () => <>⤮</>,
  fields: [
    defineField({
      name: "from",
      type: "string",
      title: "From",
      description: 'The original path (e.g., "/old-page").',
      validation: redirectPathValidation("from"),
    }),
    defineField({
      name: "to",
      type: "string",
      title: "To",
      description: 'The destination path, optionally with a section anchor (e.g., "/new-page" or "/#contact").',
      validation: redirectPathValidation("to"),
    }),
    defineField({
      name: "statusCode",
      type: "number",
      title: "Kind",
      validation: (R) => R.required(),
      initialValue: 301,
      options: {
        list: Object.entries(redirectStatus).map(([value, title]) => ({
          title,
          value: Number(value),
        })),
      },
    }),
  ],
  preview: {
    select: {
      to: "to",
      from: "from",
      statusCode: "statusCode",
    },
    prepare: ({ from, to, statusCode }) => {
      return {
        title: `${from} -> ${to}`,
        subtitle: redirectStatus[statusCode as keyof typeof redirectStatus],
      };
    },
  },
});
