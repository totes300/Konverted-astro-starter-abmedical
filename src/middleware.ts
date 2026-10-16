import { sequence } from "astro:middleware";
import type { MiddlewareHandler } from "astro";
import { rewriteToAgentMarkdown } from "~/features/agents/markdown-rewrite";
import { notFoundRender } from "~/features/agents/serve-agent-markdown";
import { canonicalRequestPath } from "~/features/auth/canonical-path";
import { DRAFT_SESSION_COOKIE, verifyDraftSession } from "~/features/auth/draft-session";
import { runExemptRoute } from "~/features/auth/exempt-route";
import { gateAlways, gateByCms } from "~/features/auth/gates";
import { classifyRequest, requestPathname } from "~/features/auth/request-gate";
import { isSectionPreviewPath, SECTION_PREVIEW_ROBOTS } from "~/features/page-builder/section-preview-path";
import { IS_DEV } from "~/features/utils/constants";
import { PUBLIC_SANITY_PROJECT_ID, PUBLIC_SANITY_STUDIO_BASE_PATH, PUBLIC_SITE_URL, SANITY_API_VIEW_TOKEN } from "~/lib/env";
import { securityHeaders } from "~/lib/security-headers";

// Runtime gates: CMS-managed HTTP Basic Auth and agent content negotiation, keyed on one canonical path.
// The order is the contract (docs/features/basic-auth.md); each step's logic lives in its feature module.

const SECURITY_HEADERS = securityHeaders({
  siteUrl: PUBLIC_SITE_URL,
  sanityProjectId: PUBLIC_SANITY_PROJECT_ID,
  isDev: IS_DEV,
  // A host system variable rather than app config, read at runtime like Vercel sets it.
  isVercelPreview: process.env.VERCEL_ENV === "preview",
});

function isStudioRequest(routePattern: string): boolean {
  const base = PUBLIC_SANITY_STUDIO_BASE_PATH.replace(/\/$/, "");

  return routePattern === base || routePattern.startsWith(`${base}/`);
}

const responseHeaders: MiddlewareHandler = async (context, next) => {
  const response = await next();
  const pathname = requestPathname(context.request);

  // Every answer under the specimen's prefix, the 401 and 404 included, so nothing indexes or follows it.
  if (isSectionPreviewPath(pathname) || isSectionPreviewPath(canonicalRequestPath(pathname) ?? "")) {
    response.headers.set("X-Robots-Tag", SECTION_PREVIEW_ROBOTS);
  }

  for (const [name, value] of SECURITY_HEADERS.always) {
    response.headers.set(name, value);
  }

  // The Studio loads its own set of origins; it gets a policy of its own or none.
  if (!isStudioRequest(context.routePattern)) {
    response.headers.set("Content-Security-Policy-Report-Only", SECURITY_HEADERS.reportOnly);
  }

  return response;
};

/** A Studio preview session is only one the draft-mode enable route signed; the preview cookies alone are forgeable. */
const draftSession: MiddlewareHandler = async (context, next) => {
  context.locals.draftSession =
    !context.isPrerendered && (await verifyDraftSession(SANITY_API_VIEW_TOKEN, context.cookies.get(DRAFT_SESSION_COOKIE)?.value));
  return next();
};

const runtimeGates: MiddlewareHandler = async (context, next) => {
  const decision = classifyRequest({
    routePattern: context.routePattern,
    pathname: requestPathname(context.request),
    studioBasePath: PUBLIC_SANITY_STUDIO_BASE_PATH,
  });

  if (decision.kind === "exempt") {
    return runExemptRoute(next);
  }

  if (decision.kind === "bad-request") {
    return new Response("Bad Request", { status: 400 });
  }

  if (decision.kind === "section-preview") {
    return gateAlways(context, next, "The section preview");
  }

  // Empty, so Astro renders the 404 page, whose own pass through here gates it as the page it names.
  if (decision.kind === "not-found") {
    return new Response(null, { status: 404 });
  }

  // A signed Studio preview session: Basic Auth must not run, and drafts must not reach the cache.
  if (context.locals.draftSession) {
    context.cache.set(false);
    return next();
  }

  const notFound = notFoundRender(context, PUBLIC_SITE_URL, next);

  // An agent's 404 is the Markdown recovery map, still behind the gate, so a locked site or protected page never gets it.
  if (notFound) {
    return gateByCms(context, notFound, decision.path);
  }

  // Ahead of the gate but deferring to it: a page Basic Auth covers is never rewritten to Markdown.
  const markdown = await rewriteToAgentMarkdown(context, decision.path);

  if (markdown) {
    return markdown;
  }

  return gateByCms(context, next, decision.path);
};

export const onRequest = sequence(responseHeaders, draftSession, runtimeGates);
